import { afterAll, beforeAll, expect, mock, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { loadConfig, type ServerConfig } from "../../src/config";
import { createGuardedHttpApp } from "../../src/http-guard";
import { createMcpHttpApp } from "../../src/mcp/http-app";
import { launcherFixture } from "../fixtures/launcher";

let fixture: Awaited<ReturnType<typeof launcherFixture>>;
let config: ServerConfig;
beforeAll(async () => {
	fixture = await launcherFixture();
	config = await loadConfig("http", fixture.env);
});
afterAll(async () => {
	await fixture.cleanup();
});

function harness() {
	const app = createGuardedHttpApp(config, fixture.env, () => config.port);
	const handler = mock(() => undefined);
	const spawn = mock(() => undefined);
	app.use("*", async (_context, next) => {
		handler();
		await next();
	});
	app.all("/spawn-probe", (context) => {
		spawn();
		return context.text("ok");
	});
	createMcpHttpApp(app);
	return { app, handler, spawn };
}

function approvedHeaders() {
	return {
		Authorization: `Bearer ${fixture.token}`,
		Host: `127.0.0.1:${config.port}`,
	};
}

async function denied(path: string, init: RequestInit, status: 401 | 403) {
	const { app, handler, spawn } = harness();
	const transport = spyOn(
		WebStandardStreamableHTTPServerTransport.prototype,
		"handleRequest"
	);
	try {
		const response = await app.request(path, init);
		expect(response.status).toBe(status);
		expect(response.headers.get("content-type")).toBe(
			"text/plain; charset=UTF-8"
		);
		const text = await response.text();
		const body = status === 401 ? "Unauthorized" : "Forbidden";
		expect(text).toBe(init.method === "HEAD" ? "" : body);
		expect(text.includes(fixture.token)).toBe(false);
		expect(handler).toHaveBeenCalledTimes(0);
		expect(spawn).toHaveBeenCalledTimes(0);
		expect(transport).toHaveBeenCalledTimes(0);
	} finally {
		transport.mockRestore();
	}
}

for (const method of [
	"GET",
	"POST",
	"DELETE",
	"OPTIONS",
	"PUT",
	"PATCH",
	"HEAD",
]) {
	for (const path of ["/mcp", "/mcp/", "/", "/missing", "/spawn-probe"]) {
		for (const auth of ["missing", "incorrect"]) {
			test(`${method} ${path}: ${auth} bearer denies before handler, transport, and spawn`, async () => {
				await denied(
					path,
					{
						headers: {
							Host: approvedHeaders().Host,
							...(auth === "incorrect"
								? { Authorization: `Bearer ${randomBytes(32).toString("hex")}` }
								: {}),
						},
						method,
					},
					401
				);
			});
		}
	}
}

for (const kind of [
	"basic",
	"empty",
	"short",
	"long",
	"duplicate",
	"extra-field",
	"different-case-token",
]) {
	test(`malformed or incorrect Authorization: ${kind}`, async () => {
		const authorization: Record<string, string> = {
			basic: `Basic ${fixture.token}`,
			"different-case-token": `Bearer ${fixture.token.toUpperCase()}`,
			duplicate: `Bearer ${fixture.token}, Bearer ${fixture.token}`,
			empty: "Bearer",
			"extra-field": `Bearer ${fixture.token} ignored`,
			long: `Bearer ${fixture.token.repeat(2)}`,
			short: `Bearer ${fixture.token.slice(1)}`,
		};
		await denied(
			"/mcp",
			{
				headers: {
					...approvedHeaders(),
					Authorization: authorization[kind] ?? "",
				},
			},
			401
		);
	});
}

for (const host of [
	undefined,
	"attacker.example.com",
	"localhost",
	"127.0.0.1",
	"[::1]",
	"localhost:1",
	"127.0.0.1:1",
	"launcher.example.com:443",
	"launcher.example.com.attacker.test",
	"launcher.example.com,attacker.test",
	"127.0.0.2:0",
]) {
	test(`unapproved Host ${host ?? "absent"} denies a valid bearer`, async () => {
		const headers: Record<string, string> = {
			Authorization: approvedHeaders().Authorization,
		};
		if (host !== undefined) {
			headers.Host = host;
		}
		await denied("/spawn-probe", { headers }, 403);
	});
}

for (const origin of [
	"",
	"null",
	"https://attacker.example.com",
	"http://launcher.example.com",
	"https://launcher.example.com/",
	"https://launcher.example.com.attacker.test",
	"http://localhost:1",
	"https://launcher.example.com https://attacker.test",
]) {
	test(`unapproved present Origin ${origin || "empty"} denies a valid bearer`, async () => {
		await denied(
			"/spawn-probe",
			{ headers: { ...approvedHeaders(), Origin: origin } },
			403
		);
	});
}

for (const hostKind of ["ipv4", "localhost", "ipv6", "tunnel"]) {
	for (const originKind of ["absent", "approved"]) {
		test(`approved ${hostKind} Host and ${originKind} Origin reach the handler`, async () => {
			const hosts: Record<string, string> = {
				ipv4: `127.0.0.1:${config.port}`,
				ipv6: `[::1]:${config.port}`,
				localhost: `localhost:${config.port}`,
				tunnel: fixture.env.TETHERTERM_TUNNEL_HOSTNAME,
			};
			const host = hosts[hostKind] as string;
			const { app, handler, spawn } = harness();
			const response = await app.request("/spawn-probe", {
				headers: {
					...approvedHeaders(),
					Host: host,
					...(originKind === "approved"
						? {
								Origin: `${hostKind === "tunnel" ? "https" : "http"}://${host}`,
							}
						: {}),
				},
			});
			expect(response.status).toBe(200);
			expect(handler).toHaveBeenCalledTimes(1);
			expect(spawn).toHaveBeenCalledTimes(1);
		});
	}
}

for (const encoding of ["hex", "base64", "base64url"] as const) {
	test(`configured random 32-byte ${encoding} token authenticates with case-insensitive Bearer scheme`, async () => {
		const token = randomBytes(32).toString(encoding);
		const env = { ...fixture.env, CUSTOM_BEARER: token };
		const loaded = await loadConfig("http", env);
		const app = createGuardedHttpApp(loaded, env, () => loaded.port);
		app.get("/", (context) => context.text("ok"));
		const response = await app.request("/", {
			headers: { ...approvedHeaders(), Authorization: `bEaReR ${token}` },
		});
		expect(response.status).toBe(200);
	});
}

test("malformed JSON is denied before MCP body parsing", async () => {
	await denied(
		"/mcp",
		{
			body: "{invalid-json",
			headers: {
				"Content-Type": "application/json",
				Host: approvedHeaders().Host,
			},
			method: "POST",
		},
		401
	);
});

for (const key of ["token", "access_token", "bearer"]) {
	test(`URL-only ${key} credential never authenticates`, async () => {
		await denied(
			`/mcp?${key}=${fixture.token}`,
			{ headers: { Host: approvedHeaders().Host } },
			401
		);
	});
}

test("denied credential and terminal-content sentinels never appear in diagnostics", async () => {
	const error = spyOn(console, "error").mockImplementation(() => undefined);
	const log = spyOn(console, "log").mockImplementation(() => undefined);
	const sentinel = randomBytes(32).toString("hex");
	try {
		await denied(
			`/mcp?token=${fixture.token}`,
			{
				body: sentinel,
				headers: {
					...approvedHeaders(),
					Host: `${fixture.token}.attacker.test`,
				},
				method: "POST",
			},
			403
		);
		await denied(
			"/mcp",
			{
				headers: {
					...approvedHeaders(),
					Origin: `https://${sentinel}.attacker.test`,
				},
			},
			403
		);
		const output = JSON.stringify([...error.mock.calls, ...log.mock.calls]);
		expect(output.includes(fixture.token)).toBe(false);
		expect(output.includes(sentinel)).toBe(false);
	} finally {
		error.mockRestore();
		log.mockRestore();
	}
});

test("downstream errors and exceptions cannot echo credentials in responses or logs", async () => {
	const app = createGuardedHttpApp(config, fixture.env, () => config.port);
	const sentinel = randomBytes(32).toString("hex");
	app.get("/reflected", (context) => context.text(fixture.token, 400));
	app.get("/exception", () => {
		throw new Error(`${fixture.token}${sentinel}`);
	});
	const error = spyOn(console, "error").mockImplementation(() => undefined);
	try {
		for (const [path, status] of [
			["/reflected", 400],
			["/exception", 500],
		] as const) {
			// biome-ignore lint/performance/noAwaitInLoops: Check each independent error boundary sequentially while the log spy is active.
			const response = await app.request(path, { headers: approvedHeaders() });
			expect(response.status).toBe(status);
			expect(await response.text()).toBe("Request rejected");
		}
		const output = JSON.stringify(error.mock.calls);
		expect(output.includes(fixture.token)).toBe(false);
		expect(output.includes(sentinel)).toBe(false);
	} finally {
		error.mockRestore();
	}
});

for (const method of [
	"GET",
	"POST",
	"DELETE",
	"OPTIONS",
	"PUT",
	"PATCH",
	"HEAD",
]) {
	for (const header of ["Host", "Origin"]) {
		test(`${method} /mcp: valid bearer with unapproved ${header} never reaches the transport`, async () => {
			await denied(
				"/mcp",
				{
					headers: {
						...approvedHeaders(),
						[header]:
							header === "Host"
								? "attacker.example.com"
								: "https://attacker.example.com",
					},
					method,
				},
				403
			);
		});
	}
}
