import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("server boots without MongoDB or keys and curl receives HTTP 200 on an ephemeral port", async () => {
	const server = Bun.spawn([process.execPath, serverEntrypoint], {
		cwd: new URL("../..", import.meta.url).pathname,
		env: { PATH: "/usr/bin:/bin", PORT: "0" },
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
		console.log(
			`PORT=${port} ENV=PATH,PORT ONLY; curl /healthz: ${response.trim()}`
		);
	} finally {
		if (server.exitCode === null) {
			server.kill("SIGTERM");
		}
		await withTimeout(server.exited);
		await reader.cancel();
		reader.releaseLock();
	}
}, 10_000);

test("server startup fails clearly when setsid is absent on PATH", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "tetherterm-101-boot-"));
	let server: ReturnType<typeof Bun.spawn> | undefined;
	try {
		const started = Bun.spawn([process.execPath, serverEntrypoint], {
			cwd,
			env: { PATH: cwd, PORT: "0" },
			stderr: "pipe",
			stdout: "pipe",
		});
		server = started;
		const output = await withTimeout(new Response(started.stderr).text());
		expect(await withTimeout(started.exited)).not.toBe(0);
		expect(output).toContain("require util-linux setsid on PATH");
		expect(output).not.toContain("TetherTerm listening");
	} finally {
		if (server) {
			if (server.exitCode === null) {
				server.kill("SIGKILL");
			}
			await withTimeout(server.exited);
		}
		await rm(cwd, { force: true, recursive: true });
	}
});
