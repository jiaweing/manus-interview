import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config";
import { spawnPty } from "../../src/pty/spawn";
import { SessionManager } from "../../src/sessions/manager";
import type { PtyHandle } from "../../src/sessions/session";

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

async function cleanup(pty: PtyHandle): Promise<void> {
	try {
		if (pty.child.exitCode === null) {
			try {
				process.kill(-pty.child.pid, "SIGKILL");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
					throw error;
				}
				pty.child.kill("SIGKILL");
			}
		}
		await bounded(pty.child.exited);
	} finally {
		pty.terminal.close();
	}
}

test("session ring captures pre-registration/native data and reads a quiet running PTY synchronously", async () => {
	const root = await mkdtemp(join(tmpdir(), "tetherterm-107-output-"));
	let pty: PtyHandle | undefined;
	try {
		const env = {
			PATH: "/usr/bin:/bin",
			TETHERTERM_APPROVED_EXECUTABLES: '["bash"]',
			TETHERTERM_APPROVED_ROOT: root,
		};
		const config = await loadConfig("stdio", env);
		const manager = new SessionManager(config, {
			env,
			spawn(options) {
				// Exercise callbacks before spawn returns and the Session exists.
				options.onData(new TextEncoder().encode("early🙂"));
				pty = spawnPty(options);
				return pty;
			},
		});
		const created = await manager.create({
			args: [
				"--noprofile",
				"--norc",
				"-c",
				"test -t 0 && test -t 1 || exit 99; printf '\\033[31mready漢\\033[0m'; exec sleep 60",
			],
			cwd: root,
			executable: "bash",
		});
		const session = manager.get(created.sessionId);
		const expected = "early🙂\u001b[31mready漢\u001b[0m";
		const deadline = Date.now() + 4000;
		let ready = false;
		while (Date.now() < deadline) {
			// biome-ignore lint/performance/noAwaitInLoops: Poll only the owned PTY for actual exec/read readiness.
			const command = await readFile(
				`/proc/${session.pty.child.pid}/cmdline`,
				"utf8"
			);
			if (
				command === "sleep\u000060\u0000" &&
				session.output.read("0").output === expected
			) {
				ready = true;
				break;
			}
			await Bun.sleep(5);
		}
		expect(ready).toBe(true);
		const result = manager.read({ cursor: "0", sessionId: created.sessionId });
		expect(result).not.toBeInstanceOf(Promise);
		expect(result).toEqual({
			gap: false,
			headCursor: String(new TextEncoder().encode(expected).byteLength),
			nextCursor: String(new TextEncoder().encode(expected).byteLength),
			oldestCursor: "0",
			output: expected,
			state: "running",
		});
		expect(session.receivedBytes).toBe(
			new TextEncoder().encode(expected).byteLength
		);
		for (let count = 0; count < 100; count += 1) {
			const quiet = manager.read({
				cursor: result.nextCursor,
				sessionId: created.sessionId,
			});
			expect(quiet).not.toBeInstanceOf(Promise);
			expect(quiet.output).toBe("");
			expect(quiet.nextCursor).toBe(result.nextCursor);
			expect(quiet.state).toBe("running");
		}
		expect(session.pty.child.exitCode).toBeNull();
		session.state = "terminating";
		expect(
			manager.read({ cursor: "0", sessionId: created.sessionId }).state
		).toBe("terminating");
		expect(() => manager.read({ cursor: "0", sessionId: "missing" })).toThrow(
			expect.objectContaining({ code: "NOT_FOUND" })
		);
		expect(() =>
			manager.read({ cursor: "-1", sessionId: created.sessionId })
		).toThrow(expect.objectContaining({ code: "BAD_CURSOR" }));
		process.kill(-session.pty.child.pid, "SIGKILL");
		await bounded(session.pty.child.exited);
		expect(
			manager.read({ cursor: "0", sessionId: created.sessionId }).state
		).toBe("exited");
	} finally {
		try {
			if (pty) {
				await cleanup(pty);
				const probe = Bun.spawn(
					["ps", "-o", "pid=,stat=", "-p", String(pty.child.pid)],
					{
						stderr: "pipe",
						stdout: "pipe",
					}
				);
				try {
					const output = await bounded(new Response(probe.stdout).text());
					expect([0, 1]).toContain(await bounded(probe.exited));
					expect(output.trim()).toBe("");
					console.log(
						`OUTPUT_RING_OWN_PID_PS pid=${pty.child.pid} no process remains`
					);
				} finally {
					if (probe.exitCode === null) {
						probe.kill("SIGKILL");
					}
					await bounded(probe.exited);
				}
			}
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	}
});
