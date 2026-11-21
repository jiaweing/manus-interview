import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type ServerConfig } from "../src/config";
import { TerminalError } from "../src/errors";
import { type SpawnPtyOptions, spawnPty } from "../src/pty/spawn";
import {
	type CreateSessionRequest,
	DEFAULT_RUNTIME_MS,
	SessionManager,
} from "../src/sessions/manager";
import { EXIT_RETENTION_MS } from "../src/sessions/retention";
import type { PtyHandle } from "../src/sessions/session";

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const whitespacePattern = /\s+/;
const ownPids = new Set<number>();
interface RegistryFixture {
	clock: { now: number };
	config: ServerConfig;
	control: { failSpawn: boolean; spawnCalls: number };
	manager: SessionManager;
	observations: SpawnPtyOptions[];
	ptys: PtyHandle[];
	root: string;
}
const fixtures: RegistryFixture[] = [];

function firstOf<T>(values: readonly T[]): T {
	const [first] = values;
	if (first === undefined) {
		throw new Error("Expected a fixture entry");
	}
	return first;
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error("Fixture timed out")), 4000);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function fixture(now = 1000): Promise<RegistryFixture> {
	const root = await mkdtemp(join(tmpdir(), "tetherterm-104-registry-"));
	await mkdir(join(root, "nested"));
	await symlink(join(root, "nested"), join(root, "inside"));
	const env = {
		PATH: "/usr/bin:/bin",
		TETHERTERM_APPROVED_EXECUTABLES: '["bash"]',
		TETHERTERM_APPROVED_ROOT: root,
	};
	const config = await loadConfig("stdio", env);
	const ptys: PtyHandle[] = [];
	const observations: SpawnPtyOptions[] = [];
	const control: RegistryFixture["control"] = {
		failSpawn: false,
		spawnCalls: 0,
	};
	const clock = { now };
	const manager = new SessionManager(config, {
		clock: { now: () => clock.now },
		env,
		spawn(options) {
			control.spawnCalls += 1;
			if (control.failSpawn) {
				throw new Error("Synthetic spawn failure");
			}
			const pty = spawnPty(options);
			ptys.push(pty);
			observations.push(options);
			ownPids.add(pty.child.pid);
			return pty;
		},
	});
	const result = { clock, config, control, manager, observations, ptys, root };
	fixtures.push(result);
	return result;
}

function request(
	root: string,
	overrides: Partial<CreateSessionRequest> = {}
): CreateSessionRequest {
	return {
		args: [
			"--noprofile",
			"--norc",
			"-c",
			"test -t 0 && test -t 1 || exit 99; : < /dev/tty || exit 98; exec sleep 60",
		],
		cwd: root,
		executable: "bash",
		...overrides,
	};
}

async function cleanup(pty: PtyHandle) {
	try {
		if (pty.child.exitCode === null) {
			try {
				process.kill(-pty.child.pid, "SIGKILL");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
					throw error;
				}
				// Group already disappeared; fallback targets only this owned child.
				pty.child.kill("SIGKILL");
			}
		}
		await bounded(pty.child.exited);
	} finally {
		pty.terminal.close();
	}
}

async function quietStarted(pty: PtyHandle) {
	const deadline = Date.now() + 4000;
	while (Date.now() < deadline) {
		// biome-ignore lint/performance/noAwaitInLoops: Observe actual exec readiness before asserting a quiet-running process.
		const command = await readFile(`/proc/${pty.child.pid}/cmdline`, "utf8");
		if (command === "sleep\u000060\u0000") {
			return;
		}
		if (pty.child.exitCode !== null) {
			throw new Error("Quiet fixture failed its TTY checks");
		}
		await Bun.sleep(5);
	}
	throw new Error("Quiet fixture did not exec sleep");
}

afterEach(async () => {
	await Promise.all(
		fixtures.splice(0).map(async (item) => {
			try {
				await Promise.all(item.ptys.map(cleanup));
				item.clock.now += EXIT_RETENTION_MS;
				expect(item.manager.list().sessions).toHaveLength(0);
			} finally {
				await rm(item.root, { force: true, recursive: true });
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

test("unique UUID sessions return the PRD create result and exact summary fields", async () => {
	const f = await fixture();
	const first = await f.manager.create(request(f.root));
	const second = await f.manager.create(
		request(f.root, { cols: 132, rows: 43 })
	);
	expect(first).toEqual({
		cursor: "0",
		sessionId: expect.stringMatching(uuidPattern),
		state: "running",
	});
	expect(second.sessionId).toMatch(uuidPattern);
	expect(second.sessionId).not.toBe(first.sessionId);
	expect(f.config.approvedExecutables.bash).toBe(
		firstOf(f.observations).executable
	);
	expect(f.manager.status(first.sessionId)).toEqual({
		cwd: f.root,
		dimensions: { cols: 80, rows: 24 },
		executable: firstOf(f.observations).executable,
		exitCode: null,
		id: first.sessionId,
		signal: null,
		state: "running",
	});
	expect(f.manager.status(second.sessionId).dimensions).toEqual({
		cols: 132,
		rows: 43,
	});
	expect(f.manager.list()).toEqual({
		sessions: [
			f.manager.status(first.sessionId),
			f.manager.status(second.sessionId),
		],
	});
	expect(f.observations.map(({ cols, rows }) => ({ cols, rows }))).toEqual([
		{ cols: 80, rows: 24 },
		{ cols: 132, rows: 43 },
	]);
});

test("summary uses policy-approved canonical cwd and snapshots cannot mutate sessions", async () => {
	const f = await fixture();
	const created = await f.manager.create(
		request(f.root, { cwd: join(f.root, "inside") })
	);
	const summary = f.manager.status(created.sessionId);
	expect(summary.cwd).toBe(join(f.root, "nested"));
	summary.dimensions.cols = 1;
	summary.state = "exited";
	const listed = f.manager.list();
	firstOf(listed.sessions).dimensions.rows = 1;
	listed.sessions.length = 0;
	expect(f.manager.status(created.sessionId).dimensions).toEqual({
		cols: 80,
		rows: 24,
	});
	expect(f.manager.status(created.sessionId).state).toBe("running");
	expect(f.manager.list().sessions).toHaveLength(1);
});

test("a sequential fifth live create returns typed LIMIT before spawning", async () => {
	const f = await fixture();
	await Promise.all(
		Array.from({ length: 4 }, () => f.manager.create(request(f.root)))
	);
	await expect(f.manager.create(request(f.root))).rejects.toMatchObject({
		code: "LIMIT",
	});
	expect(f.control.spawnCalls).toBe(4);
	expect(f.ptys.filter(({ child }) => child.exitCode === null)).toHaveLength(4);
});

test("concurrent creates reserve exactly four active PTYs and never spawn a fifth", async () => {
	const f = await fixture();
	const results = await Promise.allSettled(
		Array.from({ length: 8 }, () => f.manager.create(request(f.root)))
	);
	const accepted = results.filter((result) => result.status === "fulfilled");
	const rejected = results.filter((result) => result.status === "rejected");
	expect(accepted).toHaveLength(4);
	expect(rejected).toHaveLength(4);
	for (const result of rejected) {
		expect(result.reason).toBeInstanceOf(TerminalError);
		expect(result.reason.code).toBe("LIMIT");
	}
	expect(f.control.spawnCalls).toBe(4);
	expect(f.ptys).toHaveLength(4);
	expect(f.ptys.filter(({ child }) => child.exitCode === null)).toHaveLength(4);
	expect(f.manager.list().sessions).toHaveLength(4);
	console.log("CAP spawnCalls=4 activePtyCount=4 rejected=4 noFifthSpawn=true");
});

test("terminating sessions still occupy the four live slots", async () => {
	const f = await fixture();
	const results = await Promise.all(
		Array.from({ length: 4 }, () => f.manager.create(request(f.root)))
	);
	const first = firstOf(results);
	f.manager.get(first.sessionId).state = "terminating";
	expect(f.manager.status(first.sessionId).state).toBe("terminating");
	await expect(f.manager.create(request(f.root))).rejects.toMatchObject({
		code: "LIMIT",
	});
	expect(f.control.spawnCalls).toBe(4);
});

test("quiet-running status/list are synchronous and never wait on child exit", async () => {
	const f = await fixture();
	const created = await f.manager.create(request(f.root));
	await quietStarted(f.manager.get(created.sessionId).pty);
	const start = performance.now();
	for (let index = 0; index < 100; index += 1) {
		const status = f.manager.status(created.sessionId);
		const list = f.manager.list();
		expect(status).not.toBeInstanceOf(Promise);
		expect(list).not.toBeInstanceOf(Promise);
		expect(status.state).toBe("running");
		expect(status.exitCode).toBeNull();
		expect(status.signal).toBeNull();
		expect(list.sessions).toEqual([status]);
	}
	expect(performance.now() - start).toBeLessThan(1000);
	expect(firstOf(f.ptys).child.exitCode).toBeNull();
});

test("unknown IDs return typed NOT_FOUND and a new registry starts empty", async () => {
	const f = await fixture();
	for (const id of ["", "not-a-uuid", crypto.randomUUID()]) {
		expect(() => f.manager.status(id)).toThrow(TerminalError);
		expect(() => f.manager.get(id)).toThrow(
			expect.objectContaining({ code: "NOT_FOUND" })
		);
	}
	const created = await f.manager.create(request(f.root));
	const restarted = new SessionManager(f.config);
	expect(restarted.list()).toEqual({ sessions: [] });
	expect(() => restarted.status(created.sessionId)).toThrow(
		expect.objectContaining({ code: "NOT_FOUND" })
	);
});

test("a new server process cannot recognize the previous process's UUID", async () => {
	const f = await fixture();
	const fixturePath = join(
		import.meta.dir,
		"fixtures/session-registry-process.ts"
	);
	async function run(args: string[]): Promise<Record<string, unknown>> {
		const child = Bun.spawn([process.execPath, fixturePath, ...args], {
			env: { PATH: "/usr/bin:/bin" },
			stderr: "pipe",
			stdout: "pipe",
		});
		ownPids.add(child.pid);
		try {
			const output = await bounded(new Response(child.stdout).text());
			expect(await bounded(child.exited)).toBe(0);
			return JSON.parse(output);
		} finally {
			if (child.exitCode === null) {
				child.kill("SIGKILL");
			}
			await bounded(child.exited);
		}
	}
	const first = await run(["create", f.root]);
	expect(first.sessionId).toEqual(expect.stringMatching(uuidPattern));
	ownPids.add(Number(first.pid));
	const second = await run(["lookup", f.root, String(first.sessionId)]);
	expect(second).toEqual({ code: "NOT_FOUND" });
});

test("failed concurrent policy checks release every reservation and spawn nothing", async () => {
	const f = await fixture();
	const results = await Promise.allSettled(
		Array.from({ length: 4 }, () =>
			f.manager.create(request(f.root, { executable: "not-approved" }))
		)
	);
	for (const result of results) {
		expect(result.status).toBe("rejected");
		if (result.status === "rejected") {
			expect(result.reason).toMatchObject({ code: "POLICY_DENIED" });
		}
	}
	expect(f.control.spawnCalls).toBe(0);
	await Promise.all(
		Array.from({ length: 4 }, () => f.manager.create(request(f.root)))
	);
	expect(f.control.spawnCalls).toBe(4);
});

test("spawn failure releases its reservation without registering a session", async () => {
	const f = await fixture();
	f.control.failSpawn = true;
	await expect(f.manager.create(request(f.root))).rejects.toThrow(
		"Approved terminal could not be started"
	);
	expect(f.manager.list()).toEqual({ sessions: [] });
	f.control.failSpawn = false;
	await Promise.all(
		Array.from({ length: 4 }, () => f.manager.create(request(f.root)))
	);
	expect(f.ptys).toHaveLength(4);
});

test("injected clock records finite default and explicit runtime deadlines", async () => {
	const f = await fixture(42_000);
	const first = await f.manager.create(request(f.root));
	const second = await f.manager.create(
		request(f.root, { cols: 240, rows: 80, timeoutMs: 1234 })
	);
	expect(DEFAULT_RUNTIME_MS).toBe(900_000);
	expect(f.manager.get(first.sessionId).createdAt).toBe(42_000);
	expect(f.manager.get(first.sessionId).runtimeDeadline).toBe(942_000);
	expect(f.manager.get(second.sessionId).runtimeDeadline).toBe(43_234);
	expect(f.manager.status(second.sessionId).dimensions).toEqual({
		cols: 240,
		rows: 80,
	});
});

for (const invalid of [
	{ cols: 0 },
	{ cols: 241 },
	{ rows: 81 },
	{ rows: 1.5 },
	{ timeoutMs: 0 },
	{ timeoutMs: -1 },
	{ timeoutMs: Number.NaN },
	{ timeoutMs: Number.POSITIVE_INFINITY },
	{ timeoutMs: Number.MAX_SAFE_INTEGER },
]) {
	test(`invalid limits ${JSON.stringify(invalid)} fail before PTY allocation`, async () => {
		const f = await fixture();
		await expect(
			f.manager.create(request(f.root, invalid))
		).rejects.toMatchObject({ code: "LIMIT" });
		expect(f.control.spawnCalls).toBe(0);
		expect(f.manager.list()).toEqual({ sessions: [] });
	});
}

test("actual child exit updates summary and frees capacity without blocking observers", async () => {
	const f = await fixture();
	const results = await Promise.all(
		Array.from({ length: 4 }, () => f.manager.create(request(f.root)))
	);
	const session = f.manager.get(firstOf(results).sessionId);
	session.pty.child.kill("SIGTERM");
	await bounded(session.pty.child.exited);
	const summary = f.manager.status(session.id);
	expect(summary.state).toBe("exited");
	expect(summary.signal).toBe("SIGTERM");
	expect(summary.exitCode).toBe(session.pty.child.exitCode);
	await f.manager.create(request(f.root));
	expect(f.control.spawnCalls).toBe(5);
	expect(
		f.manager.list().sessions.filter(({ state }) => state === "running")
	).toHaveLength(4);
});
