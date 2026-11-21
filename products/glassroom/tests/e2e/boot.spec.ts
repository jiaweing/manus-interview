import { expect, test } from "@playwright/test";

test("secure client boot", async ({ page }) => {
	await page.goto("/");
	expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
	expect(new URL(page.url()).protocol).toBe("https:");
	await expect(page.getByTestId("boot-status")).toHaveText("secure context");
});

test("same-origin signal upgrade", async ({ page }) => {
	await page.goto("/");
	const result = await page.evaluate(
		() =>
			new Promise<{
				url: string;
				first: string;
				admitted: string;
				code: number;
			}>((resolve, reject) => {
				const ws = new WebSocket(`wss://${location.host}/signal`);
				let first = "";
				let admitted = "";
				const timer = setTimeout(() => reject(new Error("timeout")), 10_000);
				ws.onmessage = (e) => {
					if (first) {
						admitted = String(e.data);
						ws.send("not-a-chat-payload");
					} else {
						first = String(e.data);
						ws.send(
							JSON.stringify({
								operation: "join",
								role: "creator",
								roomId: "AAAAAAAAAAAAAAAAAAAAAA",
								version: 1,
							})
						);
					}
				};
				ws.onclose = (e) => {
					clearTimeout(timer);
					resolve({ admitted, code: e.code, first, url: ws.url });
				};
				ws.onerror = () => reject(new Error("ws error"));
			})
	);
	expect(result.url).toBe(
		`wss://localhost:${process.env.PUBLIC_PORT ?? "3443"}/signal`
	);
	expect(JSON.parse(result.first)).toEqual({ type: "ready" });
	expect(JSON.parse(result.admitted)).toEqual({
		role: "creator",
		roomId: "AAAAAAAAAAAAAAAAAAAAAA",
		type: "joined",
		version: 1,
	});
	// Admission is now supported, but arbitrary payloads still fail closed.
	expect(result.code).toBe(1008);
});

test("signal upgrade rejects a foreign or insecure origin", async ({
	page,
	baseURL,
}) => {
	await page.goto("/");
	const host = new URL(baseURL as string).host;
	for (const origin of [`http://${host}`, "https://evil.example"]) {
		const res = await page.request.get(`https://${host}/signal`, {
			failOnStatusCode: false,
			headers: {
				Connection: "Upgrade",
				Origin: origin,
				"Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
				"Sec-WebSocket-Version": "13",
				Upgrade: "websocket",
			},
		});
		expect(res.status()).toBe(403);
	}
});
