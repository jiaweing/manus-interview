import { describe, expect, test } from "bun:test";
import { upgradeWebSocket, websocket } from "hono/bun";
import { app } from "./app";

describe("credential-free scaffold", () => {
	test("Hono root returns 200 without service initialization", async () => {
		const response = await app.request("/");
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("OK");
	});

	test("Bun native WebSocket adapter is available", () => {
		expect(typeof upgradeWebSocket).toBe("function");
		expect(typeof websocket.open).toBe("function");
	});

	test("generated integration routes are not mounted", async () => {
		const responses = await Promise.all(
			["/api/auth/session", "/polar/success", "/ai"].map((path) =>
				app.request(path)
			)
		);
		for (const response of responses) {
			expect(response.status).toBe(404);
		}
	});
});
