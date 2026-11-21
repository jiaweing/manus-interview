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
				closedOnPayload: boolean;
				code: number;
			}>((resolve, reject) => {
				const ws = new WebSocket(`wss://${location.host}/signal`);
				let first = "";
				const timer = setTimeout(() => reject(new Error("timeout")), 10_000);
				ws.onmessage = (e) => {
					first = String(e.data);
					ws.send("not-a-chat-payload");
				};
				ws.onclose = (e) => {
					clearTimeout(timer);
					resolve({
						closedOnPayload: first.length > 0,
						code: e.code,
						first,
						url: ws.url,
					});
				};
				ws.onerror = () => reject(new Error("ws error"));
			})
	);
	expect(result.url).toBe(
		`wss://localhost:${process.env.PUBLIC_PORT ?? "3443"}/signal`
	);
	expect(JSON.parse(result.first)).toEqual({ type: "ready" });
	// the bootstrap endpoint accepts nothing: any payload closes the socket
	expect(result.closedOnPayload).toBe(true);
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
