import { describe, expect, test } from "bun:test";
import { websocket } from "hono/bun";
import { createApp } from "./app";

interface Evidence {
	bootMarker: string;
	connections: number;
}
const markerPattern = /^[0-9a-f-]{36}$/;

function nextCount(socket: WebSocket, count: number) {
	return new Promise<Evidence>((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error("Missing socket evidence")),
			3000
		);
		function onMessage(event: MessageEvent) {
			const evidence = JSON.parse(event.data) as Evidence;
			if (evidence.connections === count) {
				clearTimeout(timeout);
				socket.removeEventListener("message", onMessage);
				resolve(evidence);
			}
		}
		socket.addEventListener("message", onMessage);
	});
}

describe("native ingress (temporary transport-only)", () => {
	test("ordinary HTTP cannot substitute for a WebSocket", async () => {
		const response = await createApp().request("/api/ws");
		expect(response.status).toBe(426);
	});
	test("upgrade rejects missing or foreign Origin before reaching Bun", async () => {
		await Promise.all(
			[undefined, "https://foreign.example"].map(async (origin) => {
				const headers = new Headers({ Upgrade: "websocket" });
				if (origin) {
					headers.set("Origin", origin);
				}
				const response = await createApp().request("http://localhost/api/ws", {
					headers,
				});
				expect(response.status).toBe(403);
			})
		);
	});
	test("same process broadcasts 1 → 2 → 1 with only a public boot marker/count", async () => {
		const server = Bun.serve({
			fetch: createApp({ allowedOrigins: ["http://dev.example"] }).fetch,
			hostname: "127.0.0.1",
			port: Number(process.env.TEST_SERVER_PORT ?? 3286),
			websocket,
		});
		const url = new URL("/api/ws", server.url);
		url.protocol = "ws:";
		const a = new WebSocket(url, { headers: { Origin: server.url.origin } });
		let b: WebSocket | undefined;
		try {
			const first = await nextCount(a, 1);
			expect(first.bootMarker).toMatch(markerPattern);
			const firstUpdates = nextCount(a, 2);
			b = new WebSocket(url, { headers: { Origin: "http://dev.example" } });
			const second = await nextCount(b, 2);
			expect(await firstUpdates).toEqual(second);
			expect(second.bootMarker).toBe(first.bootMarker);
			expect(Object.keys(second).sort()).toEqual(["bootMarker", "connections"]);
			const remaining = nextCount(a, 1);
			b.close();
			expect(await remaining).toEqual(first);
		} finally {
			a.close();
			b?.close();
			await server.stop(true);
		}
	});
});
