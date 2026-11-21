import { afterEach, expect, test } from "bun:test";
import { constants } from "node:fs";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config";
import { spawnPty } from "../../src/pty/spawn";
import { SessionManager } from "../../src/sessions/manager";
import { EXIT_RETENTION_MS } from "../../src/sessions/retention";
import type { PtyHandle, Session } from "../../src/sessions/session";

const encoder = new TextEncoder();
interface Fixture {
	clock: { now: number };
	eofCalls: number;
	manager: SessionManager;
	ptys: PtyHandle[];
	root: string;
}
const fixtures: Fixture[] = [];

async function bounded<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("Output fixture timed out")),
					4000
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function poll(
	description: string,
	predicate: () => boolean
): Promise<void> {
	const deadline = Date.now() + 4000;
	while (!predicate()) {
		if (Date.now() >= deadline) {
			throw new Error(`Output fixture timed out: ${description}`);
		}
		// biome-ignore lint/performance/noAwaitInLoops: Poll observed native output, never infer EOF from silence.
		await Bun.sleep(5);
	}
}

async function fixture(early = ""): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "tetherterm-107-output-"));
	const env = {
		PATH: "/usr/bin:/bin",
		TETHERTERM_APPROVED_EXECUTABLES: '["bash","python3"]',
		TETHERTERM_APPROVED_ROOT: root,
	};
	const clock = { now: 1000 };
	const ptys: PtyHandle[] = [];
	let eofCalls = 0;
	const manager = new SessionManager(await loadConfig("stdio", env), {
		clock: { now: () => clock.now },
		env,
		spawn(options) {
			if (early) {
				// Exercise data before spawn returns and the Session is registered.
				options.onData(encoder.encode(early));
			}
			const pty = spawnPty({
				...options,
				onEof() {
					eofCalls += 1;
					options.onEof?.();
				},
			});
			ptys.push(pty);
			return pty;
		},
	});
	const f = {
		clock,
		get eofCalls() {
			return eofCalls;
		},
		manager,
		ptys,
		root,
	};
	fixtures.push(f);
	return f;
}

async function python(f: Fixture, script: string): Promise<Session> {
	const { sessionId } = await f.manager.create({
		args: [
			"-u",
			"-c",
			`import os, tty, signal\nassert os.isatty(0) and os.tcgetpgrp(0) == os.getpid()\n${script}`,
		],
		cwd: f.root,
		executable: "python3",
	});
	return f.manager.get(sessionId);
}

function read(f: Fixture, record: Session, cursor = "0", maxBytes?: number) {
	const result = f.manager.read({ cursor, maxBytes, sessionId: record.id });
	const start = result.gap ? result.oldestCursor : cursor;
	expect(BigInt(result.nextCursor)).toBe(
		BigInt(start) + BigInt(encoder.encode(result.output).byteLength)
	);
	expect(encoder.encode(result.output).byteLength).toBeLessThanOrEqual(
		Math.min(maxBytes ?? 65_536, 65_536)
	);
	expect(record.output.retainedBytes).toBeLessThanOrEqual(1_048_576);
	return result;
}

async function complete(f: Fixture, record: Session): Promise<void> {
	await bounded(Promise.all([record.pty.child.exited, record.pty.eof]));
	expect(f.eofCalls).toBe(1);
	expect(f.manager.status(record.id).state).toBe("exited");
}

async function cleanup(pty: PtyHandle): Promise<void> {
	try {
		// Include any supported ordinary descendant still holding the slave PTY.
		try {
			process.kill(-pty.child.pid, "SIGKILL");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
				throw error;
			}
			if (pty.child.exitCode === null) {
				pty.child.kill("SIGKILL");
			}
		}
		await bounded(Promise.all([pty.child.exited, pty.eof]));
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
				for (const pty of f.ptys) {
					try {
						// biome-ignore lint/performance/noAwaitInLoops: Inspect only owned child PIDs after awaited cleanup.
						const stat = await readFile(`/proc/${pty.child.pid}/stat`, "utf8");
						expect(stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ")).toBe(
							true
						);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
							throw error;
						}
					}
				}
			} finally {
				await rm(f.root, { force: true, recursive: true });
			}
		})
	);
});

test("session ring captures pre-registration/native data and reads a quiet running PTY synchronously", async () => {
	const f = await fixture("early🙂");
	const record = await python(
		f,
		"os.write(1, 'ready漢\\x1b[0m'.encode())\nos.read(0, 1)"
	);
	const expected = "early🙂ready漢\u001b[0m";
	await poll(
		"complete native ready output",
		() => record.receivedBytes === encoder.encode(expected).byteLength
	);
	const result = read(f, record);
	expect(result).not.toBeInstanceOf(Promise);
	expect(result).toMatchObject({
		gap: false,
		oldestCursor: "0",
		output: expected,
		state: "running",
	});
	for (let count = 0; count < 100; count += 1) {
		const quiet = read(f, record, result.nextCursor);
		expect(quiet.output).toBe("");
		expect(quiet.nextCursor).toBe(result.nextCursor);
		expect(quiet.state).toBe("running");
	}
	expect(f.eofCalls).toBe(0);
	expect(record.pty.child.exitCode).toBeNull();
	record.state = "terminating";
	expect(read(f, record).state).toBe("terminating");
	expect(() => f.manager.read({ cursor: "0", sessionId: "missing" })).toThrow(
		expect.objectContaining({ code: "NOT_FOUND" })
	);
	expect(() => read(f, record, "-1")).toThrow(
		expect.objectContaining({ code: "BAD_CURSOR" })
	);
});

test("real PTY fragmented multibyte output across reads stays incomplete until native continuation callbacks", async () => {
	const f = await fixture();
	const record = await python(
		f,
		String.raw`tty.setraw(0)
os.write(1, b'A\xf0')
os.read(0, 1)
os.write(1, b'\x9f')
os.read(0, 1)
os.write(1, b'\x99\x82')
os.read(0, 1)
os.write(1, 'é漢\x1b[0m'.encode())`
	);
	await poll("first fragmented callback", () => record.receivedBytes === 2);
	const first = read(f, record);
	expect(first.output).toBe("A");
	expect(first.headCursor).toBe("1");
	await f.manager.write({ sessionId: record.id, text: "x" });
	await poll("second fragmented callback", () => record.receivedBytes === 3);
	expect(read(f, record, first.nextCursor).output).toBe("");
	expect(f.eofCalls).toBe(0);
	await f.manager.write({ sessionId: record.id, text: "x" });
	await poll("completed emoji callback", () => record.receivedBytes === 5);
	const second = read(f, record, first.nextCursor, 4);
	expect(second.output).toBe("🙂");
	expect(second.nextCursor).toBe("5");
	await f.manager.write({ sessionId: record.id, text: "x" });
	await complete(f, record);
	const final = read(f, record, second.nextCursor);
	expect(final.output).toBe("é漢\u001b[0m");
	expect(first.output + second.output + final.output).toBe("A🙂é漢\u001b[0m");
	expect(read(f, record, final.nextCursor).output).toBe("");
});

test("real PTY truncated multibyte suffix at EOF becomes one replacement with exact normalized cursor", async () => {
	const f = await fixture();
	const record = await python(
		f,
		"os.write(1, bytes([0x61, 0xf0, 0x9f]))\nos._exit(7)"
	);
	await complete(f, record);
	expect(record.receivedBytes).toBe(3);
	expect(read(f, record)).toMatchObject({
		headCursor: "4",
		nextCursor: "4",
		output: "a�",
		state: "exited",
	});
	expect(read(f, record, "1", 2).output).toBe("");
	expect(read(f, record, "1", 3).output).toBe("�");
	const before = read(f, record);
	record.output.finish();
	expect(read(f, record)).toEqual(before);
	expect(f.manager.status(record.id)).toMatchObject({
		exitCode: 7,
		signal: null,
	});
});

test("real PTY raw 0xFF is stored as U+FFFD and counted as three UTF-8 bytes", async () => {
	const f = await fixture();
	const record = await python(f, "os.write(1, bytes([0xff]))");
	await complete(f, record);
	expect(record.receivedBytes).toBe(1);
	expect(read(f, record, "0", 2).nextCursor).toBe("0");
	expect(read(f, record, "0", 3)).toMatchObject({
		headCursor: "3",
		nextCursor: "3",
		output: "�",
	});
	expect(() => read(f, record, "1")).toThrow(
		expect.objectContaining({ code: "BAD_CURSOR" })
	);
	expect(() => read(f, record, "2")).toThrow(
		expect.objectContaining({ code: "BAD_CURSOR" })
	);
});

test("real PTY final data after child exit completes a split character before EOF and remains retained", async () => {
	const f = await fixture();
	// The ordinary same-group descendant holds the PTY slave. A FIFO handshake
	// releases final bytes only after the test observes actual session-leader exit.
	const record = await python(
		f,
		String.raw`signal.signal(signal.SIGHUP, signal.SIG_IGN)
os.mkfifo('release')
pid = os.fork()
if pid == 0:
    fd = os.open('release', os.O_RDONLY)
    os.read(fd, 1)
    os.close(fd)
    os.write(1, b'\x99\x82late\x1b[0m')
    os._exit(0)
os.write(1, b'A\xf0\x9f')
os._exit(7)`
	);
	await bounded(record.pty.child.exited);
	await poll("leader prefix received", () => record.receivedBytes === 3);
	const first = read(f, record);
	expect(first).toMatchObject({
		headCursor: "1",
		nextCursor: "1",
		output: "A",
		state: "exited",
	});
	expect(f.eofCalls).toBe(0);
	// Capacity is released at child exit even while this session's output is open.
	const replacements = await Promise.all(
		Array.from({ length: 4 }, () => python(f, "os.read(0, 1)"))
	);
	await expect(python(f, "os.read(0, 1)")).rejects.toMatchObject({
		code: "LIMIT",
	});
	expect(replacements).toHaveLength(4);
	await expect(
		f.manager.write({ sessionId: record.id, text: "after actual exit" })
	).rejects.toMatchObject({ code: "NOT_RUNNING" });
	const gate = await open(join(f.root, "release"), constants.O_RDWR);
	try {
		await gate.write("x");
	} finally {
		await gate.close();
	}
	await bounded(record.pty.eof);
	expect(f.eofCalls).toBe(1);
	const final = read(f, record, first.nextCursor);
	expect(final.output).toBe("🙂late\u001b[0m");
	expect(final.state).toBe("exited");
	const retained = read(f, record);
	f.clock.now += EXIT_RETENTION_MS - 1;
	expect(f.manager.get(record.id)).toBe(record);
	expect(read(f, record)).toEqual(retained);
	f.clock.now += 1;
	expect(() => read(f, record)).toThrow(
		expect.objectContaining({ code: "NOT_FOUND" })
	);
	expect(f.manager.list().sessions).toHaveLength(4);
});

test("real PTY signal exit finalizes output without substituting EOF status for actual SIGTERM", async () => {
	const f = await fixture();
	const record = await python(
		f,
		"os.write(1, bytes([0x53, 0xf0, 0x9f]))\nos.kill(os.getpid(), signal.SIGTERM)"
	);
	await complete(f, record);
	expect(f.manager.status(record.id)).toMatchObject({
		exitCode: record.pty.child.exitCode,
		signal: "SIGTERM",
		state: "exited",
	});
	expect(read(f, record)).toMatchObject({
		headCursor: "4",
		nextCursor: "4",
		output: "S�",
	});
});
