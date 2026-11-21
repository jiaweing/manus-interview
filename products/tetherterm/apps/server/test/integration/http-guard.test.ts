import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer } from "../../src/http";
import { launcherFixture } from "../fixtures/launcher";

const productRoot = new URL("../../../..", import.meta.url).pathname;
const addressPattern = /http:\/\/127\.0\.0\.1:(\d+)\/mcp/;
const methods = ["GET", "POST", "DELETE", "OPTIONS", "PUT", "PATCH", "HEAD"];

function capture(stream: ReadableStream<Uint8Array>) {
	let output = "";
	const done = (async () => {
		const decoder = new TextDecoder();
		for await (const chunk of stream) {
			output += decoder.decode(chunk, { stream: true });
		}
		output += decoder.decode();
	})();
	return { done, output: () => output };
}

async function launch() {
	const fixture = await launcherFixture();
	const child = Bun.spawn([process.execPath, "run", "terminal:http"], {
		cwd: productRoot,
		env: fixture.env,
		stderr: "pipe",
		stdout: "pipe",
	});
	const stderr = capture(child.stderr);
	const stdout = capture(child.stdout);
	async function stop() {
		try {
			if (child.exitCode === null) {
				child.kill("SIGTERM");
			}
			await child.exited;
			await Promise.all([stderr.done, stdout.done]);
		} finally {
			await fixture.cleanup();
		}
	}
	try {
		const deadline = Date.now() + 5000;
		while (!addressPattern.test(stderr.output())) {
			if (child.exitCode !== null || Date.now() >= deadline) {
				throw new Error("guard launcher failed to become ready");
			}
			// biome-ignore lint/performance/noAwaitInLoops: Poll only this owned process's readiness under a deadline.
			await Bun.sleep(10);
		}
		const port = Number(stderr.output().match(addressPattern)?.[1]);
		expect(port).toBeGreaterThan(0);
		return {
			child,
			endpoint: new URL(`http://127.0.0.1:${port}/mcp`),
			fixture,
			port,
			stderr,
			stdout,
			stop,
		};
	} catch (error) {
		if (child.exitCode === null) {
			child.kill("SIGKILL");
		}
		await stop();
		throw error;
	}
}

function newClient() {
	return new Client({ name: "tetherterm-http-guard-proof", version: "0.1.0" });
}

async function deniedResponse(
	response: Response,
	method: string,
	status: 401 | 403
) {
	expect(response.status).toBe(status);
	expect(response.headers.get("content-type")).toBe(
		"text/plain; charset=UTF-8"
	);
	const body = status === 401 ? "Unauthorized" : "Forbidden";
	expect(await response.text()).toBe(method === "HEAD" ? "" : body);
}

test("real HTTP launcher: official SDK rejects without Authorization and authenticates initialization and subsequent discovery", async () => {
	const server = await launch();
	const client = newClient();
	const unauthorized = newClient();
	try {
		await expect(
			unauthorized.connect(new StreamableHTTPClientTransport(server.endpoint))
		).rejects.toMatchObject({ code: 401 });
		const headers = new Headers({
			Authorization: `Bearer ${server.fixture.token}`,
		});
		const transport = new StreamableHTTPClientTransport(server.endpoint, {
			requestInit: { headers },
		});
		await client.connect(transport);
		expect(client.getServerVersion()?.name).toBe("tetherterm");
		expect(await client.listTools()).toEqual({ tools: [] });
		headers.delete("Authorization");
		await expect(client.listTools()).rejects.toMatchObject({ code: 401 });
		headers.set("Authorization", `Bearer ${randomBytes(32).toString("hex")}`);
		await expect(client.listTools()).rejects.toMatchObject({ code: 401 });
		headers.set("Authorization", `Bearer ${server.fixture.token}`);
		headers.set("Origin", "https://attacker.example.com");
		await expect(client.listTools()).rejects.toMatchObject({ code: 403 });
		headers.set(
			"Origin",
			`https://${server.fixture.env.TETHERTERM_TUNNEL_HOSTNAME}`
		);
		expect(await client.listTools()).toEqual({ tools: [] });
		headers.delete("Origin");
		expect(await client.listTools()).toEqual({ tools: [] });
	} finally {
		await Promise.all([client.close(), unauthorized.close()]);
		await server.stop();
	}
	expect(server.child.exitCode).toBe(0);
	expect(server.stdout.output()).toBe("");
	expect(
		(server.stderr.output() + server.stdout.output()).includes(
			server.fixture.token
		)
	).toBe(false);
}, 15_000);

test("real launcher socket: all methods and unknown routes reject credentials, Host, Origin and URL-only authentication; stdout/stderr never contain sentinels", async () => {
	const server = await launch();
	const sentinel = randomBytes(32).toString("hex");
	const wrong = randomBytes(32).toString("hex");
	try {
		await Promise.all(
			methods.flatMap((method) =>
				["/mcp", "/missing", "/"].flatMap((path) => {
					const endpoint = new URL(path, server.endpoint);
					const approved = { Authorization: `Bearer ${server.fixture.token}` };
					const cases: [URL, Record<string, string>, 401 | 403][] = [
						[endpoint, {}, 401],
						[endpoint, { Authorization: `Bearer ${wrong}` }, 401],
						[endpoint, { ...approved, Host: `${sentinel}.attacker.test` }, 403],
						[
							endpoint,
							{ ...approved, Origin: `https://${sentinel}.attacker.test` },
							403,
						],
						[
							new URL(`${path}?token=${server.fixture.token}`, server.endpoint),
							{},
							401,
						],
					];
					return cases.map(async ([url, headers, status]) => {
						const response = await fetch(url, {
							headers,
							method,
							signal: AbortSignal.timeout(5000),
							...(method === "POST" ? { body: sentinel } : {}),
						});
						await deniedResponse(response, method, status);
					});
				})
			)
		);
		const approved = { Authorization: `Bearer ${server.fixture.token}` };
		await Promise.all(
			methods.map(async (method) => {
				const response = await fetch(server.endpoint, {
					headers: approved,
					method,
					signal: AbortSignal.timeout(5000),
				});
				// The stateless JSON SDK rejects GET/DELETE/OPTIONS itself, not at
				// the security boundary; malformed POST is likewise an SDK error.
				expect([401, 403].includes(response.status)).toBe(false);
			})
		);
		const unknown = await fetch(new URL("/missing", server.endpoint), {
			headers: approved,
		});
		expect(unknown.status).toBe(404);
		const malformed = await fetch(server.endpoint, {
			body: `{${server.fixture.token}${sentinel}`,
			headers: {
				...approved,
				Accept: "application/json, text/event-stream",
				"Content-Type": "application/json",
			},
			method: "POST",
		});
		expect(malformed.status).toBe(400);
		const malformedBody = await malformed.text();
		expect(malformedBody.includes(server.fixture.token)).toBe(false);
		expect(malformedBody.includes(sentinel)).toBe(false);
		const reflectedHeader = await fetch(server.endpoint, {
			body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }),
			headers: {
				...approved,
				Accept: "application/json, text/event-stream",
				"Content-Type": "application/json",
				"Mcp-Protocol-Version": server.fixture.token,
			},
			method: "POST",
		});
		expect(reflectedHeader.status).toBe(400);
		expect(await reflectedHeader.text()).toBe("Request rejected");
		const client = newClient();
		try {
			await client.connect(
				new StreamableHTTPClientTransport(server.endpoint, {
					requestInit: { headers: approved },
				})
			);
			expect(await client.listTools()).toEqual({ tools: [] });
		} finally {
			await client.close();
		}
	} finally {
		await server.stop();
	}
	const captured = server.stdout.output() + server.stderr.output();
	expect(server.stdout.output()).toBe("");
	for (const credential of [server.fixture.token, wrong, sentinel]) {
		expect(captured.includes(credential)).toBe(false);
	}
}, 15_000);

test("HTTP is loopback-bound and Host allowlist uses the actual ephemeral bound port, not configured zero", async () => {
	const fixture = await launcherFixture();
	const server = await startHttpServer(fixture.env);
	try {
		expect(server.hostname).toBe("127.0.0.1");
		expect(server.port).toBeGreaterThan(0);
		const endpoint = `http://127.0.0.1:${server.port}/missing`;
		for (const host of [
			`127.0.0.1:${server.port}`,
			`localhost:${server.port}`,
			`[::1]:${server.port}`,
			fixture.env.TETHERTERM_TUNNEL_HOSTNAME,
		]) {
			// biome-ignore lint/performance/noAwaitInLoops: Verify each approved Host through this single real listener.
			const response = await fetch(endpoint, {
				headers: { Authorization: `Bearer ${fixture.token}`, Host: host },
			});
			expect(response.status).toBe(404);
		}
		const response = await fetch(endpoint, {
			headers: {
				Authorization: `Bearer ${fixture.token}`,
				Host: "127.0.0.1:0",
			},
		});
		await deniedResponse(response, "GET", 403);
	} finally {
		await server.stop(true);
		await fixture.cleanup();
	}
});

test("stdio remains owner-trusted: official SDK initializes and discovers with no token or tunnel environment", async () => {
	const fixture = await launcherFixture();
	const client = newClient();
	const transport = new StdioClientTransport({
		args: ["run", "terminal:stdio"],
		command: process.execPath,
		cwd: productRoot,
		env: {
			PATH: fixture.env.PATH,
			TETHERTERM_APPROVED_EXECUTABLES:
				fixture.env.TETHERTERM_APPROVED_EXECUTABLES,
			TETHERTERM_APPROVED_ROOT: fixture.root,
		},
		stderr: "pipe",
	});
	let diagnostics = "";
	transport.stderr?.on("data", (chunk: Buffer) => {
		diagnostics += chunk.toString();
	});
	try {
		await client.connect(transport);
		expect(await client.listTools()).toEqual({ tools: [] });
		expect(diagnostics).toContain("TetherTerm MCP ready on stdio");
		expect(diagnostics.includes(fixture.token)).toBe(false);
	} finally {
		await client.close();
		await fixture.cleanup();
	}
}, 15_000);
