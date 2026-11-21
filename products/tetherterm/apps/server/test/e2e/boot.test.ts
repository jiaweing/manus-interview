import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launcherFixture } from "../fixtures/launcher";

const addressPattern = /http:\/\/127\.0\.0\.1:(\d+)/;
const serverEntrypoint = new URL("../../src/index.ts", import.meta.url)
	.pathname;

async function withTimeout<T>(promise: Promise<T>) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("boot proof timed out")),
					5000
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

test("server boots with valid configuration without MongoDB or addon keys and curl receives HTTP 200 on an ephemeral port", async () => {
	const fixture = await launcherFixture();
	const { TETHERTERM_PORT: _port, ...env } = fixture.env;
	const server = Bun.spawn([process.execPath, serverEntrypoint], {
		cwd: new URL("../..", import.meta.url).pathname,
		// Exercise the validated legacy alias rather than bypassing the loader.
		env: { ...env, PORT: "0" },
		stderr: "pipe",
		stdout: "pipe",
	});
	const reader = server.stderr.getReader();
	let output = "";
	try {
		await withTimeout(
			(async () => {
				while (!addressPattern.test(output)) {
					// biome-ignore lint/performance/noAwaitInLoops: One stream reader must consume boot output sequentially.
					const chunk = await reader.read();
					if (chunk.done) {
						throw new Error(`server exited before boot: ${output}`);
					}
					output += new TextDecoder().decode(chunk.value);
				}
			})()
		);
		const port = Number(output.match(addressPattern)?.[1]);
		expect(port).toBeGreaterThan(0);
		const curl = Bun.spawn(
			[
				"curl",
				"--silent",
				"--show-error",
				"--fail",
				"--max-time",
				"3",
				"--write-out",
				"\nHTTP_STATUS=%{http_code}\n",
				`http://127.0.0.1:${port}/healthz`,
			],
			{
				env: { PATH: "/usr/bin:/bin" },
				stderr: "pipe",
				stdout: "pipe",
			}
		);
		const response = await withTimeout(new Response(curl.stdout).text());
		expect(await withTimeout(curl.exited)).toBe(0);
		expect(response).toBe("ok\nHTTP_STATUS=200\n");
		expect(output.includes(fixture.token)).toBe(false);
		console.log(
			`PORT=${port} CONFIG=VALID legacy_PORT=0; curl /healthz: ${response.trim()}`
		);
	} finally {
		if (server.exitCode === null) {
			server.kill("SIGTERM");
		}
		await withTimeout(server.exited);
		await reader.cancel();
		reader.releaseLock();
		await fixture.cleanup();
	}
}, 10_000);

test("server startup fails clearly when setsid is absent on PATH", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "tetherterm-101-boot-"));
	const fixture = await launcherFixture();
	let server: ReturnType<typeof Bun.spawn> | undefined;
	try {
		const started = Bun.spawn([process.execPath, serverEntrypoint], {
			cwd,
			env: { ...fixture.env, PATH: cwd },
			stderr: "pipe",
			stdout: "pipe",
		});
		server = started;
		const output = await withTimeout(new Response(started.stderr).text());
		expect(await withTimeout(started.exited)).not.toBe(0);
		expect(output).toContain("require util-linux setsid on PATH");
		expect(output).not.toContain("TetherTerm listening");
		expect(output.includes(fixture.token)).toBe(false);
	} finally {
		if (server) {
			if (server.exitCode === null) {
				server.kill("SIGKILL");
			}
			await withTimeout(server.exited);
		}
		await rm(cwd, { force: true, recursive: true });
		await fixture.cleanup();
	}
});
