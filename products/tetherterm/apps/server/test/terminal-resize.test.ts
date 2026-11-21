import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { TerminalError } from "../src/errors";
import { spawnPty } from "../src/pty/spawn";
import {
	type CreateSessionRequest,
	SessionManager,
} from "../src/sessions/manager";
import type { ResizeSessionRequest } from "../src/sessions/resize";
import { EXIT_RETENTION_MS } from "../src/sessions/retention";
import type { PtyHandle } from "../src/sessions/session";

interface ResizeFixture {
	clock: { now: number };
	manager: SessionManager;
	output: () => string;
	ptys: PtyHandle[];
	request: CreateSessionRequest;
	root: string;
	spawnCalls: () => number;
}

const fixtures: ResizeFixture[] = [];
const ownPids = new Set<number>();
const invalidValues: { label: string; value: unknown }[] = [
	{ label: "zero", value: 0 },
	{ label: "negative", value: -1 },
	{ label: "fractional", value: 1.5 },
	{ label: "NaN", value: Number.NaN },
	{ label: "infinity", value: Number.POSITIVE_INFINITY },
	{ label: "numeric string", value: "120" },
	{ label: "boolean", value: true },
	{ label: "null", value: null },
	{ label: "array", value: [1] },
	{ label: "object", value: {} },
];

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

async function waitFor(f: ResizeFixture, text: string) {
	const deadline = Date.now() + 4000;
	while (!f.output().includes(text)) {
		if (Date.now() >= deadline) {
			throw new Error(`Missing ${text}; fixture output: ${f.output()}`);
		}
		// biome-ignore lint/performance/noAwaitInLoops: Poll real child output sequentially until readiness or the deadline.
		await Bun.sleep(5);
	}
}

async function fixture(): Promise<ResizeFixture> {
	const root = await mkdtemp(join(tmpdir(), "tetherterm-109-resize-"));
	const env = {
		PATH: "/usr/bin:/bin",
		TETHERTERM_APPROVED_EXECUTABLES: '["python3"]',
		TETHERTERM_APPROVED_ROOT: root,
	};
	const ptys: PtyHandle[] = [];
	let output = "";
	let spawnCalls = 0;
	const decoder = new TextDecoder();
	const clock = { now: 1000 };
	const manager = new SessionManager(await loadConfig("stdio", env), {
		clock: { now: () => clock.now },
		env,
		spawn(options) {
			spawnCalls += 1;
			const pty = spawnPty({
				...options,
				onData(bytes) {
					output += decoder.decode(bytes, { stream: true });
					options.onData(bytes);
				},
			});
			ptys.push(pty);
			ownPids.add(pty.child.pid);
			return pty;
		},
	});
	const f = {
		clock,
		manager,
		output: () => output,
		ptys,
		request: {
			args: ["-u", join(import.meta.dir, "fixtures/terminal-resize.py")],
			cwd: root,
			executable: "python3",
		},
		root,
		spawnCalls: () => spawnCalls,
	};
	fixtures.push(f);
	return f;
}

async function live(f: ResizeFixture, dimensions = { cols: 80, rows: 24 }) {
	const { sessionId } = await f.manager.create({ ...f.request, ...dimensions });
	await waitFor(f, "READY");
	expect(f.output()).toContain(`INITIAL=${dimensions.cols}x${dimensions.rows}`);
	return f.manager.get(sessionId);
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

afterEach(async () => {
	await Promise.all(
		fixtures.splice(0).map(async (f) => {
			try {
				await Promise.all(f.ptys.map(cleanup));
				f.clock.now += EXIT_RETENTION_MS;
				expect(f.manager.list().sessions).toHaveLength(0);
			} finally {
				await rm(f.root, { force: true, recursive: true });
			}
		})
	);
});

afterAll(async () => {
	for (const pid of ownPids) {
		try {
			// biome-ignore lint/performance/noAwaitInLoops: Inspect only owned PIDs after their awaited cleanup.
			const stat = await readFile(`/proc/${pid}/stat`, "utf8");
			expect(stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ")).toBe(true);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
		}
	}
	console.log(`RESIZE_CLEANUP checked=${ownPids.size} no live owned processes`);
});

function expectCode(
	action: () => unknown,
	code: "LIMIT" | "NOT_FOUND" | "NOT_RUNNING"
) {
	expect(action).toThrow(TerminalError);
	expect(action).toThrow(expect.objectContaining({ code }));
}

function assertDimensions(
	f: ResizeFixture,
	id: string,
	cols: number,
	rows: number
) {
	expect(f.manager.status(id).dimensions).toEqual({ cols, rows });
	expect(
		f.manager.list().sessions.find((session) => session.id === id)?.dimensions
	).toEqual({ cols, rows });
}

test("live resize changes child size, delivers SIGWINCH and updates result/status/list", async () => {
	const f = await fixture();
	const session = await live(f);
	const before = f.manager.status(session.id);
	const resize = spyOn(session.pty.terminal, "resize");
	try {
		const result = f.manager.resize(session.id, { cols: 120, rows: 40 });
		expect(result).toEqual({ cols: 120, rows: 40 });
		expect(resize).toHaveBeenCalledTimes(1);
		expect(resize).toHaveBeenCalledWith(120, 40);
		await waitFor(f, "SIGWINCH=120x40");
		session.pty.terminal.write("OBSERVED\n");
		await waitFor(f, "OBSERVED=120x40");
		assertDimensions(f, session.id, 120, 40);
		expect(before.dimensions).toEqual({ cols: 80, rows: 24 });
		result.cols = 1;
		f.manager.status(session.id).dimensions.rows = 1;
		assertDimensions(f, session.id, 120, 40);
		console.log("RESIZE child=120x40 SIGWINCH=true result=status=list=120x40");
	} finally {
		resize.mockRestore();
	}
});

for (const dimensions of [
	{ cols: 1, rows: 1 },
	{ cols: 240, rows: 80 },
]) {
	test(`inclusive ${dimensions.cols}x${dimensions.rows} boundary is accepted for create and live resize`, async () => {
		const f = await fixture();
		const session = await live(f, dimensions);
		f.manager.resize(session.id, { cols: 80, rows: 24 });
		await waitFor(f, "SIGWINCH=80x24");
		expect(f.manager.resize(session.id, dimensions)).toEqual(dimensions);
		await waitFor(f, `SIGWINCH=${dimensions.cols}x${dimensions.rows}`);
		session.pty.terminal.write("BOUNDARY\n");
		await waitFor(f, `BOUNDARY=${dimensions.cols}x${dimensions.rows}`);
		assertDimensions(f, session.id, dimensions.cols, dimensions.rows);
	});
}

for (const dimension of ["cols", "rows"] as const) {
	const cases = [
		...invalidValues,
		{ label: "over-limit", value: dimension === "cols" ? 241 : 81 },
	];
	for (const { label, value } of cases) {
		test(`invalid ${dimension} ${label} rejects create and resize before touching PTY`, async () => {
			const f = await fixture();
			const invalid = {
				cols: 120,
				rows: 40,
				[dimension]: value,
			} as ResizeSessionRequest;
			await expect(
				f.manager.create({ ...f.request, ...invalid })
			).rejects.toBeInstanceOf(TerminalError);
			await expect(
				f.manager.create({ ...f.request, ...invalid })
			).rejects.toMatchObject({ code: "LIMIT" });
			expect(f.spawnCalls()).toBe(0);
			expect(f.manager.list()).toEqual({ sessions: [] });
			const session = await live(f);
			const resize = spyOn(session.pty.terminal, "resize");
			try {
				expectCode(() => f.manager.resize(session.id, invalid), "LIMIT");
				expect(resize).toHaveBeenCalledTimes(0);
				assertDimensions(f, session.id, 80, 24);
				session.pty.terminal.write("UNCHANGED\n");
				await waitFor(f, "UNCHANGED=80x24");
				expect(f.output()).not.toContain("SIGWINCH=");
			} finally {
				resize.mockRestore();
			}
		});
	}
}

test("resize requires both dimensions and never supplies creation defaults", async () => {
	const f = await fixture();
	const session = await live(f);
	const resize = spyOn(session.pty.terminal, "resize");
	try {
		for (const invalid of [
			{},
			{ cols: 120 },
			{ rows: 40 },
			{ cols: undefined, rows: 40 },
			{ cols: 120, rows: undefined },
		]) {
			expectCode(
				() =>
					f.manager.resize(
						session.id,
						invalid as unknown as ResizeSessionRequest
					),
				"LIMIT"
			);
		}
		expect(resize).toHaveBeenCalledTimes(0);
		assertDimensions(f, session.id, 80, 24);
	} finally {
		resize.mockRestore();
	}
});

test("unknown IDs return NOT_FOUND without invoking any native resize", async () => {
	const f = await fixture();
	const session = await live(f);
	const resize = spyOn(session.pty.terminal, "resize");
	try {
		for (const id of ["", "unknown", crypto.randomUUID()]) {
			expectCode(
				() => f.manager.resize(id, { cols: 120, rows: 40 }),
				"NOT_FOUND"
			);
		}
		expect(resize).toHaveBeenCalledTimes(0);
		assertDimensions(f, session.id, 80, 24);
	} finally {
		resize.mockRestore();
	}
});

test("actual exited sessions return NOT_RUNNING without native resize, even with stale running state", async () => {
	const f = await fixture();
	const session = await live(f);
	session.pty.terminal.write("exit\n");
	expect(await bounded(session.pty.child.exited)).toBe(7);
	expect(f.manager.status(session.id).state).toBe("exited");
	const resize = spyOn(session.pty.terminal, "resize");
	try {
		expectCode(
			() => f.manager.resize(session.id, { cols: 120, rows: 40 }),
			"NOT_RUNNING"
		);
		session.state = "running";
		expectCode(
			() => f.manager.resize(session.id, { cols: 120, rows: 40 }),
			"NOT_RUNNING"
		);
		session.state = "exited";
		expect(resize).toHaveBeenCalledTimes(0);
		assertDimensions(f, session.id, 80, 24);
	} finally {
		resize.mockRestore();
	}
});

test("terminating sessions return NOT_RUNNING without native resize", async () => {
	const f = await fixture();
	const session = await live(f);
	session.state = "terminating";
	const resize = spyOn(session.pty.terminal, "resize");
	try {
		expectCode(
			() => f.manager.resize(session.id, { cols: 120, rows: 40 }),
			"NOT_RUNNING"
		);
		expect(resize).toHaveBeenCalledTimes(0);
		assertDimensions(f, session.id, 80, 24);
	} finally {
		resize.mockRestore();
	}
});

test("failed native resize does not publish new dimensions", async () => {
	const f = await fixture();
	const session = await live(f);
	const resize = spyOn(session.pty.terminal, "resize").mockImplementation(
		() => {
			throw new Error("Synthetic native resize failure");
		}
	);
	try {
		expect(() => f.manager.resize(session.id, { cols: 120, rows: 40 })).toThrow(
			"Synthetic native resize failure"
		);
		expect(resize).toHaveBeenCalledTimes(1);
		assertDimensions(f, session.id, 80, 24);
		session.pty.terminal.write("FAILED\n");
		await waitFor(f, "FAILED=80x24");
	} finally {
		resize.mockRestore();
	}
});
