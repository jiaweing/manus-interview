import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config";
import { createBootApp } from "../../src/index";
import { spawnPty } from "../../src/pty/spawn";
import { launcherFixture } from "../fixtures/launcher";

async function bounded<T>(promise: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("native PTY proof timed out")),
					5000
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

test("only the boot health route is available", async () => {
	const fixture = await launcherFixture();
	try {
		const config = await loadConfig("http", fixture.env);
		const app = createBootApp(config, fixture.env, () => config.port);
		const headers = {
			Authorization: `Bearer ${fixture.token}`,
			Host: `127.0.0.1:${config.port}`,
		};
		const health = await app.request("/healthz", { headers });
		expect(health.status).toBe(200);
		expect(await health.text()).toBe("ok");
		const responses = await Promise.all(
			["/", "/ai", "/api/auth/session", "/polar/success"].map((dormant) =>
				app.request(dormant, { headers })
			)
		);
		for (const response of responses) {
			expect(response.status).toBe(404);
		}
	} finally {
		await fixture.cleanup();
	}
});

test("inline native PTY owns its controlling session and reaches EOF with no setsid on PATH", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "tetherterm-107-native-path-"));
	let pty: ReturnType<typeof spawnPty> | undefined;
	let output = "";
	let eofCalls = 0;
	try {
		expect(Bun.which("setsid", { cwd, PATH: cwd })).toBeNull();
		pty = spawnPty({
			args: [
				"-u",
				"-c",
				"import os; assert os.isatty(0) and os.isatty(1); print('%s %s %s %s' % (os.getpid(), os.getpgrp(), os.getsid(0), os.tcgetpgrp(0))); os.write(1, b'final'); os._exit(7)",
			],
			cols: 80,
			cwd,
			env: { PATH: cwd },
			executable: "/usr/bin/python3",
			onData(bytes) {
				output += new TextDecoder().decode(bytes);
			},
			onEof() {
				eofCalls += 1;
			},
			rows: 24,
		});
		expect(pty.child.terminal).toBe(pty.terminal);
		await bounded(Promise.all([pty.child.exited, pty.eof]));
		expect(output).toBe(
			`${pty.child.pid} ${pty.child.pid} ${pty.child.pid} ${pty.child.pid}\r\nfinal`
		);
		expect(pty.child.exitCode).toBe(7);
		expect(eofCalls).toBe(1);
		expect(process.kill(process.pid, 0)).toBe(true);
		pty.terminal.close();
		expect(eofCalls).toBe(1);
	} finally {
		if (pty) {
			if (pty.child.exitCode === null) {
				pty.child.kill("SIGKILL");
			}
			try {
				await bounded(pty.child.exited);
			} finally {
				pty.terminal.close();
			}
		}
		await rm(cwd, { force: true, recursive: true });
	}
});

test("inline spawn failure propagates the error without a reusable terminal", () => {
	expect(() =>
		spawnPty({
			cols: 80,
			cwd: "/nonexistent/tetherterm-101-cwd",
			env: { PATH: "/usr/bin:/bin" },
			executable: "bash",
			onData() {
				// No output is expected: spawn must fail for a nonexistent cwd.
			},
			rows: 24,
		})
	).toThrow();
});
