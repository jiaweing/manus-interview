import { afterAll, beforeAll, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import {
	JSONRPCMessageSchema,
	LATEST_PROTOCOL_VERSION,
} from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { startHttpServer } from "../src/http";
import { createMcpHttpApp } from "../src/mcp/http-app";
import { launcherFixture } from "./fixtures/launcher";

const productRoot = new URL("../../..", import.meta.url).pathname;
const httpAddressPattern = /http:\/\/127\.0\.0\.1:(\d+)\/mcp/;
const linePattern = /\r?\n/;
const timeoutMs = 5000;
let fixture: Awaited<ReturnType<typeof launcherFixture>>;

beforeAll(async () => {
	fixture = await launcherFixture();
});

afterAll(async () => {
	await fixture.cleanup();
});

async function withTimeout<T>(promise: Promise<T>) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("transport boot proof timed out")),
					timeoutMs
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

function captureStream(stream: ReadableStream<Uint8Array>) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let output = "";
	return {
		async drain() {
			await this.until(() => false, true);
			reader.releaseLock();
			return output;
		},
		output: () => output,
		async until(predicate: (text: string) => boolean, allowEnd = false) {
			await withTimeout(
				(async () => {
					while (!predicate(output)) {
						// biome-ignore lint/performance/noAwaitInLoops: Consume one stream sequentially under a deadline.
						const chunk = await reader.read();
						if (chunk.done) {
							output += decoder.decode();
							if (allowEnd) {
								return;
							}
							throw new Error("entrypoint exited before expected output");
						}
						output += decoder.decode(chunk.value, { stream: true });
					}
				})()
			);
		},
	};
}

async function stopChild(child: ReturnType<typeof Bun.spawn>) {
	if (child.exitCode === null) {
		child.kill("SIGKILL");
	}
	await withTimeout(child.exited);
}

function newClient() {
	return new Client({ name: "tetherterm-transport-boot", version: "0.1.0" });
}

async function assertDiscovery(client: Client) {
	expect(client.getServerVersion()).toEqual({
		name: "tetherterm",
		version: "0.1.0",
	});
	expect(client.getServerCapabilities()?.tools).toBeDefined();
	expect(await withTimeout(client.listTools())).toEqual({ tools: [] });
}

test("official SDK client initializes and discovers tools through the stdio root launcher", async () => {
	const client = newClient();
	const errors: Error[] = [];
	client.onerror = (error) => errors.push(error);
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
		await withTimeout(client.connect(transport));
		await assertDiscovery(client);
		expect(diagnostics).toContain("TetherTerm MCP ready on stdio");
		expect(errors).toEqual([]);
		console.log(
			"stdio SDK initialize=OK tools/list=EMPTY protocol_errors=0 stderr_startup=OK"
		);
	} finally {
		await withTimeout(client.close());
	}
}, 15_000);

test("stdio stdout contains only complete SDK-valid protocol messages and stderr contains startup diagnostics", async () => {
	const child = Bun.spawn([process.execPath, "run", "terminal:stdio"], {
		cwd: productRoot,
		env: fixture.env,
		stderr: "pipe",
		stdin: "pipe",
		stdout: "pipe",
	});
	const stdout = captureStream(child.stdout);
	const stderr = captureStream(child.stderr);
	try {
		child.stdin.write(
			serializeMessage({
				id: 0,
				jsonrpc: "2.0",
				method: "initialize",
				params: {
					capabilities: {},
					clientInfo: { name: "stdio-capture", version: "0.1.0" },
					protocolVersion: LATEST_PROTOCOL_VERSION,
				},
			})
		);
		await stdout.until((text) => text.includes("\n"));
		child.stdin.write(
			serializeMessage({ jsonrpc: "2.0", method: "notifications/initialized" })
		);
		child.stdin.write(
			serializeMessage({ id: 1, jsonrpc: "2.0", method: "tools/list" })
		);
		await stdout.until((text) => text.split(linePattern).length >= 3);
		child.stdin.end();
		const [protocol, diagnostics, exitCode] = await Promise.all([
			stdout.drain(),
			stderr.drain(),
			withTimeout(child.exited),
		]);
		expect(exitCode).toBe(0);
		expect(protocol.endsWith("\n")).toBe(true);
		const messages = protocol
			.trim()
			.split(linePattern)
			.map((line) => JSONRPCMessageSchema.parse(JSON.parse(line)));
		expect(messages).toHaveLength(2);
		expect(messages[0]).toMatchObject({
			id: 0,
			jsonrpc: "2.0",
			result: { serverInfo: { name: "tetherterm" } },
		});
		expect(messages[1]).toEqual({
			id: 1,
			jsonrpc: "2.0",
			result: { tools: [] },
		});
		expect(diagnostics).toContain("TetherTerm MCP ready on stdio");
		expect(protocol).not.toContain("TetherTerm MCP ready");
		expect((protocol + diagnostics).includes(fixture.token)).toBe(false);
		console.log(
			"stdio stdout=2 SDK-valid JSON-RPC lines diagnostics_on_stderr=OK EOF_exit=0"
		);
	} finally {
		await stopChild(child);
	}
}, 15_000);

test("HTTP entrypoint initializes and discovers with the official Streamable HTTP client", async () => {
	const child = Bun.spawn([process.execPath, "run", "terminal:http"], {
		cwd: productRoot,
		env: fixture.env,
		stderr: "pipe",
		stdout: "pipe",
	});
	const stderr = captureStream(child.stderr);
	const stdout = captureStream(child.stdout);
	const client = newClient();
	const errors: Error[] = [];
	client.onerror = (error) => errors.push(error);
	try {
		await stderr.until((text) => httpAddressPattern.test(text));
		const port = Number(stderr.output().match(httpAddressPattern)?.[1]);
		expect(port).toBeGreaterThan(0);
		const endpoint = new URL(`http://127.0.0.1:${port}/mcp`);
		const transport = new StreamableHTTPClientTransport(endpoint);
		await withTimeout(client.connect(transport));
		await assertDiscovery(client);
		expect(transport.sessionId).toBeUndefined();
		expect(errors).toEqual([]);
		const extraRoutes = await Promise.all(
			["/", "/healthz", "/ai", "/api/auth/session"].map((path) =>
				fetch(new URL(path, endpoint))
			)
		);
		for (const response of extraRoutes) {
			expect(response.status).toBe(404);
		}
		await withTimeout(client.close());
		child.kill("SIGTERM");
		expect(await withTimeout(child.exited)).toBe(0);
		expect(await stdout.drain()).toBe("");
		await stderr.drain();
		expect(stderr.output().includes(fixture.token)).toBe(false);
		console.log(
			"HTTP SDK initialize=OK tools/list=EMPTY stateless=OK extra_routes=404 stdout=EMPTY"
		);
	} finally {
		await withTimeout(client.close());
		await stopChild(child);
	}
}, 15_000);

test("HTTP listener binds only loopback and isolates concurrent clients without transport sessions", async () => {
	const listener = await startHttpServer(fixture.env);
	const clients = [newClient(), newClient()];
	try {
		expect(listener.hostname).toBe("127.0.0.1");
		expect(listener.port).toBeGreaterThan(0);
		const endpoint = new URL(`http://127.0.0.1:${listener.port}/mcp`);
		await Promise.all(
			clients.map(async (client) => {
				await withTimeout(
					client.connect(new StreamableHTTPClientTransport(endpoint))
				);
				await assertDiscovery(client);
			})
		);
		console.log(
			"HTTP bound_hostname=127.0.0.1 ephemeral_port=OK concurrent_clients=2 discovery=OK"
		);
	} finally {
		await Promise.all(clients.map((client) => withTimeout(client.close())));
		await listener.stop(true);
	}
}, 15_000);

test("Hono middleware installed before mounting /mcp runs before the transport", async () => {
	const app = new Hono();
	let seen = 0;
	app.use("/mcp", async (context, next) => {
		seen += 1;
		await next();
		context.header("x-middleware-order", "before-mcp");
	});
	createMcpHttpApp(app);
	const response = await app.request("/mcp", { method: "PUT" });
	expect(seen).toBe(1);
	expect(response.status).toBe(405);
	expect(response.headers.get("x-middleware-order")).toBe("before-mcp");
});
