import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { spawnPty } from "../src/pty/spawn";
import { SessionManager } from "../src/sessions/manager";
import {
	EXIT_RETENTION_MS,
	MAX_SESSION_RECORDS,
} from "../src/sessions/retention";
import type { PtyHandle } from "../src/sessions/session";
import { retentionUnitCases } from "./fixtures/session-retention-cases";

retentionUnitCases();

interface Fixture {
	clock: { now: number };
	closed: Set<PtyHandle>;
	manager: SessionManager;
	output: Map<PtyHandle, Uint8Array[]>;
	ptys: PtyHandle[];
	root: string;
}

const fixtures: Fixture[] = [];
const ownPids = new Set<number>();
const whitespacePattern = /\s+/;

async function bounded<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("PTY fixture timed out")),
					4000
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function fixture(): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "tetherterm-105-retention-"));
	const env = {
		PATH: "/usr/bin:/bin",
		TETHERTERM_APPROVED_EXECUTABLES: '["bash"]',
		TETHERTERM_APPROVED_ROOT: root,
	};
	const config = await loadConfig("stdio", env);
	const clock = { now: 1000 };
	const ptys: PtyHandle[] = [];
	const closed = new Set<PtyHandle>();
	const output = new Map<PtyHandle, Uint8Array[]>();
	const manager = new SessionManager(config, {
		clock: { now: () => clock.now },
		env,
		spawn(options) {
			const chunks: Uint8Array[] = [];
			const pty = spawnPty({
				...options,
				onData(bytes) {
					chunks.push(bytes.slice());
					options.onData(bytes);
				},
			});
			const close = pty.terminal.close.bind(pty.terminal);
			pty.terminal.close = () => {
				closed.add(pty);
				close();
			};
			output.set(pty, chunks);
			ptys.push(pty);
			ownPids.add(pty.child.pid);
			return pty;
		},
	});
	const result = { clock, closed, manager, output, ptys, root };
	fixtures.push(result);
	return result;
}

async function create(f: Fixture, script = "exec sleep 60") {
	return await f.manager.create({
		args: [
			"--noprofile",
			"--norc",
			"-c",
			`test -t 0 && test -t 1 || exit 99; : < /dev/tty || exit 98; ${script}`,
		],
		cwd: f.root,
		executable: "bash",
	});
}

async function quietStarted(pty: PtyHandle): Promise<void> {
	const deadline = Date.now() + 4000;
	while (Date.now() < deadline) {
		// biome-ignore lint/performance/noAwaitInLoops: Poll actual exec readiness, not an arbitrary sleep.
		const command = await readFile(`/proc/${pty.child.pid}/cmdline`, "utf8");
		if (command === "sleep\u000060\u0000") {
			return;
		}
		if (pty.child.exitCode !== null) {
			throw new Error("Quiet fixture failed controlling-terminal checks");
		}
		await Bun.sleep(5);
	}
	throw new Error("Quiet fixture failed to exec");
}

async function cleanup(pty: PtyHandle): Promise<void> {
	try {
		if (pty.child.exitCode === null) {
			try {
				process.kill(-pty.child.pid, "SIGKILL");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
					throw error;
				}
				// setsid has not run yet; these fixtures never fork descendants.
				pty.child.kill("SIGKILL");
			}
		}
		await bounded(pty.child.exited);
	} finally {
		pty.terminal.close();
	}
}

afterEach(async () => {
	await Promise.all(
		fixtures.splice(0).map(async (f) => {
			try {
				await Promise.all(f.ptys.map(cleanup));
				// Expire all exited records and cancel their unreferenced timers.
				f.clock.now += EXIT_RETENTION_MS;
				expect(f.manager.list().sessions).toHaveLength(0);
			} finally {
				await rm(f.root, { force: true, recursive: true });
			}
		})
	);
});

afterAll(async () => {
	if (ownPids.size === 0) {
		return;
	}
	const child = Bun.spawn(
		["ps", "-o", "pid=,stat=,comm=", "-p", [...ownPids].join(",")],
		{ stderr: "pipe", stdout: "pipe" }
	);
	try {
		const output = await bounded(new Response(child.stdout).text());
		expect([0, 1]).toContain(await bounded(child.exited));
		console.log(`OWN_PID_PS checked=${[...ownPids].join(",")}`);
		console.log(output.trim() || "OWN_PID_PS: no recorded process remains");
		for (const line of output.trim().split("\n").filter(Boolean)) {
			expect(line.trim().split(whitespacePattern)[1]?.startsWith("Z")).toBe(
				true
			);
		}
	} finally {
		if (child.exitCode === null) {
			child.kill("SIGKILL");
		}
		await bounded(child.exited);
	}
});

test("quiet real PTY stays running across silence and retention-clock advances", async () => {
	const f = await fixture();
	const created = await create(f);
	const record = f.manager.get(created.sessionId);
	await quietStarted(record.pty);
	f.clock.now += EXIT_RETENTION_MS * 2;
	for (let index = 0; index < 20; index += 1) {
		expect(f.manager.status(record.id)).toMatchObject({
			exitCode: null,
			signal: null,
			state: "running",
		});
		expect(f.manager.list().sessions).toHaveLength(1);
	}
	expect(record.receivedBytes).toBe(0);
	expect(f.closed.has(record.pty)).toBe(false);
});

test("real PTY exit 7 preserves final output and summary until exact five-minute expiry", async () => {
	const f = await fixture();
	const created = await create(f, "printf 'final-output\\033[0m\\n'; exit 7");
	const record = f.manager.get(created.sessionId);
	// Test-only attached output exercises record preservation without implementing #107's ring.
	const buffered = Object.assign(record, {
		finalOutput: f.output.get(record.pty),
	});
	expect(await bounded(record.pty.child.exited)).toBe(7);
	const deadline = Date.now() + 4000;
	while (record.receivedBytes === 0 && Date.now() < deadline) {
		// biome-ignore lint/performance/noAwaitInLoops: Wait for the native PTY's final data callback with a bounded deadline.
		await Bun.sleep(5);
	}
	expect(record.receivedBytes).toBeGreaterThan(0);
	expect(f.manager.status(record.id)).toMatchObject({
		exitCode: 7,
		signal: null,
		state: "exited",
	});
	const output = Buffer.concat(buffered.finalOutput ?? []).toString();
	expect(output).toContain("final-output\u001b[0m");
	f.clock.now += EXIT_RETENTION_MS - 1;
	expect(f.manager.get(record.id)).toBe(buffered);
	expect(Buffer.concat(buffered.finalOutput ?? []).toString()).toBe(output);
	expect(f.closed.has(record.pty)).toBe(false);
	expect(f.manager.list().sessions).toHaveLength(1);
	f.clock.now += 1;
	expect(() => f.manager.status(record.id)).toThrow(
		expect.objectContaining({ code: "NOT_FOUND" })
	);
	expect(() => f.manager.get(record.id)).toThrow(
		expect.objectContaining({ code: "NOT_FOUND" })
	);
	expect(f.manager.list().sessions).toHaveLength(0);
	expect(f.closed.has(record.pty)).toBe(true);
});

test("real PTY signal exit records actual SIGTERM rather than guessing from silence", async () => {
	const f = await fixture();
	const created = await create(f, "kill -TERM $$");
	const record = f.manager.get(created.sessionId);
	await bounded(record.pty.child.exited);
	expect(f.manager.status(record.id)).toMatchObject({
		exitCode: record.pty.child.exitCode,
		signal: "SIGTERM",
		state: "exited",
	});
	expect(f.closed.has(record.pty)).toBe(false);
});

test("actual exit frees a live slot while the exited ID remains visible", async () => {
	const f = await fixture();
	const created = await Promise.all(Array.from({ length: 4 }, () => create(f)));
	await expect(create(f)).rejects.toMatchObject({ code: "LIMIT" });
	const [first] = created;
	if (!first) {
		throw new Error("Expected four created sessions");
	}
	const record = f.manager.get(first.sessionId);
	await quietStarted(record.pty);
	process.kill(-record.pty.child.pid, "SIGTERM");
	await bounded(record.pty.child.exited);
	const replacement = await create(f);
	expect(replacement.state).toBe("running");
	expect(f.manager.status(first.sessionId).state).toBe("exited");
	expect(f.manager.list().sessions).toHaveLength(5);
	expect(
		f.manager.list().sessions.filter(({ state }) => state === "running")
	).toHaveLength(4);
});

test("real registry cap evicts oldest exited IDs on create while preserving running IDs", async () => {
	const f = await fixture();
	const live = await create(f);
	const exited: string[] = [];
	for (let index = 0; index < MAX_SESSION_RECORDS; index += 1) {
		// biome-ignore lint/performance/noAwaitInLoops: Each actual exit must free capacity and establish eviction order.
		const created = await create(f, "exit 0");
		const record = f.manager.get(created.sessionId);
		await bounded(record.pty.child.exited);
		exited.push(created.sessionId);
		expect(f.manager.list().sessions.length).toBeLessThanOrEqual(
			MAX_SESSION_RECORDS
		);
	}
	const [oldest] = exited;
	const newest = exited.at(-1);
	if (!(oldest && newest)) {
		throw new Error("Expected exited sessions");
	}
	expect(() => f.manager.status(oldest)).toThrow(
		expect.objectContaining({ code: "NOT_FOUND" })
	);
	expect(f.manager.status(newest).state).toBe("exited");
	expect(f.manager.status(live.sessionId).state).toBe("running");
	expect(f.manager.list().sessions).toHaveLength(MAX_SESSION_RECORDS);
	f.clock.now += EXIT_RETENTION_MS;
	expect(f.manager.list().sessions.map(({ id }) => id)).toEqual([
		live.sessionId,
	]);
	expect(() => f.manager.status(newest)).toThrow(
		expect.objectContaining({ code: "NOT_FOUND" })
	);
	expect(f.closed.has(f.manager.get(live.sessionId).pty)).toBe(false);
});
