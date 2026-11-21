import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../../src/index";
import { requireSetsid, spawnPty } from "../../src/pty/spawn";

test("only the boot health route is available", async () => {
	const health = await app.request("/healthz");
	expect(health.status).toBe(200);
	expect(await health.text()).toBe("ok");
	const responses = await Promise.all(
		["/", "/ai", "/api/auth/session", "/polar/success"].map((dormant) =>
			app.request(dormant)
		)
	);
	for (const response of responses) {
		expect(response.status).toBe(404);
	}
});

test("missing setsid fails clearly before allocating a PTY", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "tetherterm-101-path-"));
	try {
		expect(() => requireSetsid(cwd, cwd)).toThrow(
			"require util-linux setsid on PATH"
		);
		expect(() =>
			spawnPty({
				cols: 80,
				cwd,
				env: { PATH: cwd },
				executable: "/bin/bash",
				onData() {
					// No output is expected: dependency validation must throw first.
				},
				rows: 24,
			})
		).toThrow("install util-linux before starting the server");
	} finally {
		await rm(cwd, { force: true, recursive: true });
	}
});

test("spawn failure closes its terminal and propagates the error", () => {
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
