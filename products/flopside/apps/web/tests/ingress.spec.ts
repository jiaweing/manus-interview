import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "playwright/test";

const publicMarkerPattern = /^[0-9a-f-]{36}$/;

interface Marker {
	bootMarker: string;
	connections: number;
}
interface Handshake {
	status: number;
	url: string;
}

async function observe(page: Page) {
	const frames: Marker[] = [];
	page.on("websocket", (socket) => {
		socket.on("framereceived", ({ payload }) => {
			if (typeof payload === "string") {
				frames.push(JSON.parse(payload) as Marker);
			}
		});
	});
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Network.enable");
	const urls = new Map<string, string>();
	cdp.on("Network.webSocketCreated", (event) => {
		urls.set(event.requestId, event.url);
	});
	const handshake = new Promise<Handshake>((resolve) => {
		cdp.on("Network.webSocketHandshakeResponseReceived", (event) => {
			const url = urls.get(event.requestId);
			if (url && new URL(url).pathname === "/api/ws") {
				resolve({ status: event.response.status, url });
			}
		});
	});
	return { frames, handshake };
}

test("two production contexts receive 101 and share one boot marker with count 2", async ({
	browser,
	baseURL,
}) => {
	if (!baseURL) {
		throw new Error("Production origin is required");
	}
	const contextA = await browser.newContext();
	const contextB = await browser.newContext();
	try {
		const pageA = await contextA.newPage();
		const pageB = await contextB.newPage();
		const a = await observe(pageA);
		const b = await observe(pageB);
		const responseA = await pageA.goto(baseURL);
		expect(responseA?.status()).toBe(200);
		await expect(pageA.getByTestId("ws-status")).toHaveText("Open");
		await expect(pageA.getByTestId("connection-count")).toHaveText("1");
		const responseB = await pageB.goto(baseURL);
		expect(responseB?.status()).toBe(200);
		await expect(pageB.getByTestId("ws-status")).toHaveText("Open");
		await expect(pageA.getByTestId("connection-count")).toHaveText("2");
		await expect(pageB.getByTestId("connection-count")).toHaveText("2");
		const handshakes = await Promise.all([a.handshake, b.handshake]);
		const expectedSocket = new URL("/api/ws", baseURL);
		expectedSocket.protocol =
			expectedSocket.protocol === "https:" ? "wss:" : "ws:";
		for (const handshake of handshakes) {
			expect(handshake.status).toBe(101);
			expect(handshake.url).toBe(expectedSocket.href);
		}
		const marker = await pageA.getByTestId("boot-marker").textContent();
		expect(marker).toMatch(publicMarkerPattern);
		await expect(pageB.getByTestId("boot-marker")).toHaveText(marker ?? "");
		for (const frames of [a.frames, b.frames]) {
			expect(frames).toContainEqual({ bootMarker: marker, connections: 2 });
			for (const frame of frames) {
				expect(Object.keys(frame).sort()).toEqual([
					"bootMarker",
					"connections",
				]);
			}
		}
		const evidenceDir = fileURLToPath(
			new URL("../../../evidence/ingress/", import.meta.url)
		);
		await mkdir(evidenceDir, { recursive: true });
		await pageA.screenshot({
			fullPage: true,
			path: `${evidenceDir}context-a.png`,
		});
		await pageB.screenshot({
			fullPage: true,
			path: `${evidenceDir}context-b.png`,
		});
		await writeFile(
			`${evidenceDir}marker-config.json`,
			`${JSON.stringify(
				{
					backendInstancesConfigured: 1,
					bootMarker: marker,
					configuration:
						"root start.ts direct Bun entry + Dockerfile: one Bun process, no Next runtime/cluster",
					contextA: a.frames,
					contextB: b.frames,
					handshakeObservation:
						"Chromium CDP Network.webSocketHandshakeResponseReceived",
					handshakes,
					mode: "production Next static export + Hono/Bun native WebSockets",
					origin: baseURL,
					probe:
						"TEMPORARY transport-only; replace with authentication before release (#49)",
				},
				null,
				2
			)}\n`
		);
		// Closing one context updates the live count on the surviving socket.
		await contextB.close();
		await expect(pageA.getByTestId("connection-count")).toHaveText("1");
	} finally {
		await contextA.close();
		await contextB.close();
	}
});
