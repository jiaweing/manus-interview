import { describe, expect, spyOn, test } from "bun:test";
import { fakeAdapter, TEST_TOKEN, VALID_TURN } from "../../tests/turn-fixtures";
import { createProxyApp, type TurnAdapter } from "./app";
import { loadProxyConfig } from "./config";

function setup(
	overrides: Record<string, string> = {},
	now: () => number = Date.now
) {
	const config = loadProxyConfig({
		SIDEKICK_DEMO_TOKEN: TEST_TOKEN,
		...overrides,
	});
	const { turn } = fakeAdapter();
	return { app: createProxyApp(config, { turn }, now), turn };
}

function post(
	app: ReturnType<typeof createProxyApp>,
	body = JSON.stringify(VALID_TURN),
	headers: Record<string, string> = {}
) {
	return app.request("/v1/agent/turn", {
		body,
		headers: {
			Authorization: `Bearer ${TEST_TOKEN}`,
			"Content-Type": "application/json",
			...headers,
		},
		method: "POST",
	});
}

describe("bearer authentication independent of CORS", () => {
	for (const [caseIndex, authorization] of [
		"",
		"Bearer wrong",
		"Bearer short",
		`Bearer ${TEST_TOKEN}extra`,
		`Basic ${TEST_TOKEN}`,
		"Bearer",
		`Bearer ${TEST_TOKEN} extra`,
	].entries()) {
		test(`rejects malformed/missing/incorrect authorization (case ${caseIndex})`, async () => {
			const { app, turn } = setup();
			const response = await post(app, "{}", {
				Authorization: authorization,
				Origin: "chrome-extension://allowed-origin",
			});
			expect(response.status).toBe(401);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
			expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
			expect(turn).not.toHaveBeenCalled();
		});
	}

	test("valid token reaches only schema-validated adapter calls, with or without Origin", async () => {
		const { app, turn } = setup();
		await Promise.all(
			[
				"",
				"chrome-extension://allowed-origin",
				"https://arbitrary.example",
			].map(async (origin) => {
				const response = await post(app, undefined, { Origin: origin });
				expect(response.status).toBe(200);
				expect(response.headers.get("Cache-Control")).toBe("no-store");
			})
		);
		expect(turn).toHaveBeenCalledTimes(3);
		expect(turn.mock.calls[0]?.[0]).toEqual(VALID_TURN);
	});

	test("preflight never calls the adapter or authorizes a subsequent POST", async () => {
		const { app, turn } = setup();
		const response = await app.request("/v1/agent/turn", {
			headers: {
				"Access-Control-Request-Headers": "Authorization,Content-Type",
				"Access-Control-Request-Method": "POST",
				Origin: "chrome-extension://allowed-origin",
			},
			method: "OPTIONS",
		});
		expect(response.status).toBe(204);
		expect((await post(app, "{}", { Authorization: "" })).status).toBe(401);
		expect(turn).not.toHaveBeenCalled();
	});
});

describe("turn validation before adapter dispatch", () => {
	for (const body of [
		"",
		" ",
		"{",
		"null",
		"[]",
		"{}",
		'{"goal":" "}',
		'{"goal":123,"messages":[],"snapshot":{}}',
		'{"goal":"Read","messages":{},"snapshot":{}}',
		'{"goal":"Read","messages":[],"snapshot":null}',
		'{"goal":"Read","messages":[],"snapshot":[]}',
	]) {
		test(`invalid envelope is 400: ${body || "empty"}`, async () => {
			const { app, turn } = setup();
			expect((await post(app, body)).status).toBe(400);
			expect(turn).not.toHaveBeenCalled();
		});
	}

	test("non-JSON content type is rejected", async () => {
		const { app, turn } = setup();
		expect(
			(await post(app, undefined, { "Content-Type": "text/plain" })).status
		).toBe(400);
		expect(turn).not.toHaveBeenCalled();
	});

	test("valid shell without adapter remains explicitly unimplemented", async () => {
		const app = createProxyApp(
			loadProxyConfig({ SIDEKICK_DEMO_TOKEN: TEST_TOKEN })
		);
		expect((await post(app)).status).toBe(501);
		expect((await post(app, "{}")).status).toBe(400);
	});
});

describe("actual request byte limit", () => {
	test("body beyond configured cap is 413 and never dispatches", async () => {
		const { app, turn } = setup({ SIDEKICK_MAX_BODY_BYTES: "20" });
		expect((await post(app)).status).toBe(413);
		expect(turn).not.toHaveBeenCalled();
	});

	test("oversized declared Content-Length is 413", async () => {
		const { app, turn } = setup({ SIDEKICK_MAX_BODY_BYTES: "20" });
		expect((await post(app, "{}", { "Content-Length": "21" })).status).toBe(
			413
		);
		expect(turn).not.toHaveBeenCalled();
	});

	test("a lying small Content-Length cannot bypass actual-byte accounting", async () => {
		const { app, turn } = setup({ SIDEKICK_MAX_BODY_BYTES: "20" });
		expect((await post(app, undefined, { "Content-Length": "1" })).status).toBe(
			413
		);
		expect(turn).not.toHaveBeenCalled();
	});

	test("multi-chunk bodies are bounded without Content-Length", async () => {
		const { app, turn } = setup({ SIDEKICK_MAX_BODY_BYTES: "20" });
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("x".repeat(12)));
				controller.enqueue(new TextEncoder().encode("x".repeat(12)));
				controller.close();
			},
		});
		const response = await app.request("/v1/agent/turn", {
			body,
			headers: {
				Authorization: `Bearer ${TEST_TOKEN}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});
		expect(response.status).toBe(413);
		expect(turn).not.toHaveBeenCalled();
	});

	test("UTF-8 bytes, not JavaScript character count, determine cap", async () => {
		const body = JSON.stringify({ ...VALID_TURN, goal: "漢".repeat(15) });
		const { app, turn } = setup({
			SIDEKICK_MAX_BODY_BYTES: String(body.length),
		});
		expect((await post(app, body)).status).toBe(413);
		expect(turn).not.toHaveBeenCalled();
	});

	test("exact byte cap is accepted", async () => {
		const body = JSON.stringify(VALID_TURN);
		const { app, turn } = setup({
			SIDEKICK_MAX_BODY_BYTES: String(
				new TextEncoder().encode(body).byteLength
			),
		});
		expect((await post(app, body)).status).toBe(200);
		expect(turn).toHaveBeenCalledTimes(1);
	});
});

describe("bounded fixed-window token rate budget", () => {
	test("429 blocks adapter, ignores spoofed IP/Origin, and resets after configured window", async () => {
		let time = 1000;
		const { app, turn } = setup(
			{
				SIDEKICK_RATE_LIMIT_MAX_REQUESTS: "2",
				SIDEKICK_RATE_LIMIT_WINDOW_MS: "2000",
			},
			() => time
		);
		expect((await post(app)).status).toBe(200);
		expect((await post(app)).status).toBe(200);
		const blocked = await post(app, undefined, {
			Origin: "https://new-origin.example",
			"X-Forwarded-For": "198.51.100.1",
		});
		expect(blocked.status).toBe(429);
		expect(blocked.headers.get("Retry-After")).toBe("2");
		expect(turn).toHaveBeenCalledTimes(2);
		time = 3000;
		expect((await post(app)).status).toBe(200);
		expect(turn).toHaveBeenCalledTimes(3);
	});

	test("unauthenticated requests do not exhaust the authenticated budget", async () => {
		const { app, turn } = setup({ SIDEKICK_RATE_LIMIT_MAX_REQUESTS: "1" });
		expect((await post(app, "{}", { Authorization: "" })).status).toBe(401);
		expect((await post(app)).status).toBe(200);
		expect(
			(await post(app, "{}", { Authorization: "Bearer wrong" })).status
		).toBe(401);
		expect(turn).toHaveBeenCalledTimes(1);
	});

	test("invalid authorized requests consume budget and cannot flood the parser", async () => {
		const { app, turn } = setup({ SIDEKICK_RATE_LIMIT_MAX_REQUESTS: "1" });
		expect((await post(app, "{}")).status).toBe(400);
		expect((await post(app, "{}")).status).toBe(429);
		expect(turn).not.toHaveBeenCalled();
	});
});

describe("environment and production HTTPS configuration", () => {
	test("missing token fails closed without serializing environment", () => {
		expect(() => loadProxyConfig({})).toThrow(
			"SIDEKICK_DEMO_TOKEN is required"
		);
		expect(() => loadProxyConfig({ SIDEKICK_DEMO_TOKEN: " " })).toThrow(
			"SIDEKICK_DEMO_TOKEN is required"
		);
	});

	for (const publicUrl of [
		undefined,
		"http://proxy.example",
		"http://localhost:8787",
		"ftp://proxy.example",
		"not-a-url",
		"https://user:dummy-key@proxy.example",
		"https://proxy.example/?token=dummy",
		"https://proxy.example/path",
		"https://proxy.example/#token",
	]) {
		test(`production rejects non-HTTPS or unsafe/missing origin: ${publicUrl ?? "absent"}`, () => {
			expect(() =>
				loadProxyConfig({
					NODE_ENV: "production",
					SIDEKICK_DEMO_TOKEN: TEST_TOKEN,
					SIDEKICK_PROXY_URL: publicUrl,
				})
			).toThrow();
		});
	}

	test("production accepts a credential-free HTTPS public origin", () => {
		const config = loadProxyConfig({
			NODE_ENV: "production",
			SIDEKICK_DEMO_TOKEN: TEST_TOKEN,
			SIDEKICK_PROXY_URL: "https://proxy.example/",
		});
		expect(config.publicUrl).toBe("https://proxy.example");
	});

	test("development HTTP is restricted to loopback", () => {
		for (const publicUrl of [
			"http://localhost:8787",
			"http://127.0.0.1:8787",
			"http://[::1]:8787",
		]) {
			expect(
				loadProxyConfig({
					SIDEKICK_DEMO_TOKEN: TEST_TOKEN,
					SIDEKICK_PROXY_URL: publicUrl,
				}).publicUrl
			).toBe(publicUrl);
		}
		expect(() =>
			loadProxyConfig({
				SIDEKICK_DEMO_TOKEN: TEST_TOKEN,
				SIDEKICK_PROXY_URL: "http://remote.example",
			})
		).toThrow();
	});

	for (const name of [
		"SIDEKICK_MAX_BODY_BYTES",
		"SIDEKICK_RATE_LIMIT_MAX_REQUESTS",
		"SIDEKICK_RATE_LIMIT_WINDOW_MS",
		"PORT",
	]) {
		test(`${name} rejects zero, negative, fractional, unsafe and empty values`, () => {
			for (const value of ["0", "-1", "1.5", "NaN", "9007199254740992", ""]) {
				expect(() =>
					loadProxyConfig({ SIDEKICK_DEMO_TOKEN: TEST_TOKEN, [name]: value })
				).toThrow();
			}
		});
	}
});

test("captured logs never contain request/response bodies, tokens, provider keys, or sensitive sentinels", async () => {
	const captured: string[] = [];
	const spies = (
		["log", "info", "debug", "warn", "error", "trace"] as const
	).map((method) =>
		spyOn(console, method).mockImplementation((...args: unknown[]) => {
			captured.push(args.map(String).join(" "));
		})
	);
	const sentinel = "SENSITIVE_BODY_SENTINEL_NOT_SECRET";
	const providerKey = "DUMMY_PROVIDER_KEY_NOT_SECRET";
	const body = JSON.stringify({
		...VALID_TURN,
		goal: sentinel,
		snapshot: { ...VALID_TURN.snapshot, text: sentinel },
	});
	const config = loadProxyConfig({
		SIDEKICK_DEMO_TOKEN: TEST_TOKEN,
		SIDEKICK_MAX_BODY_BYTES: "1024",
		SIDEKICK_RATE_LIMIT_MAX_REQUESTS: "3",
	});
	const adapter: TurnAdapter = {
		turn: () =>
			Promise.reject(new Error(`${sentinel} ${TEST_TOKEN} ${providerKey}`)),
	};
	try {
		const app = createProxyApp(config, adapter);
		expect(
			(
				await post(app, body, {
					Authorization: "Bearer wrong",
					"X-Provider-Key": providerKey,
				})
			).status
		).toBe(401);
		expect(
			(await post(app, "{", { "X-Provider-Key": providerKey })).status
		).toBe(400);
		expect((await post(app, sentinel.repeat(100))).status).toBe(413);
		const failure = await post(app, body, { "X-Provider-Key": providerKey });
		expect(failure.status).toBe(500);
		expect(await failure.text()).toBe('{"error":"Internal server error"}');
		expect((await post(app, body)).status).toBe(429);
		const successApp = createProxyApp(config, {
			turn: async () => ({ text: `${providerKey} ${sentinel}` }),
		});
		expect((await post(successApp, body)).status).toBe(200);
		for (const sensitive of [body, TEST_TOKEN, providerKey, sentinel]) {
			expect(captured.join("\n")).not.toContain(sensitive);
		}
		expect(captured).toEqual([]);
	} finally {
		for (const spy of spies) {
			spy.mockRestore();
		}
	}
});
