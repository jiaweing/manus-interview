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
      new Promise<{ url: string; first: string; admitted: string; code: number }>((resolve, reject) => {
        const ws = new WebSocket(`wss://${location.host}/signal`);
        let first = "";
        let admitted = "";
        const timer = setTimeout(() => reject(new Error("timeout")), 10_000);
        ws.onmessage = (e) => {
          if (!first) {
            first = String(e.data);
            ws.send(JSON.stringify({ version: 1, roomId: "AAAAAAAAAAAAAAAAAAAAAA", role: "creator", operation: "join" }));
          } else {
            admitted = String(e.data);
            ws.send("not-a-chat-payload");
          }
        };
        ws.onclose = (e) => {
          clearTimeout(timer);
          resolve({ url: ws.url, first, admitted, code: e.code });
        };
        ws.onerror = () => reject(new Error("ws error"));
      }),
  );
  expect(result.url).toBe(`wss://localhost:${process.env.PUBLIC_PORT ?? "3443"}/signal`);
  expect(JSON.parse(result.first)).toEqual({ type: "ready" });
  expect(JSON.parse(result.admitted)).toEqual({ type: "joined", version: 1, roomId: "AAAAAAAAAAAAAAAAAAAAAA", role: "creator" });
  // Admission is now supported, but arbitrary payloads still fail closed.
  expect(result.code).toBe(1008);
});

test("signal upgrade rejects a foreign or insecure origin", async ({ page, baseURL }) => {
  await page.goto("/");
  const host = new URL(baseURL as string).host;
  for (const origin of [`http://${host}`, "https://evil.example"]) {
    const res = await page.request.get(`https://${host}/signal`, {
      headers: { Connection: "Upgrade", Upgrade: "websocket", Origin: origin, "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(403);
  }
});
