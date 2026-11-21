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
      new Promise<{ url: string; first: string; closedOnPayload: boolean }>((resolve, reject) => {
        const ws = new WebSocket(`wss://${location.host}/signal`);
        let first = "";
        const timer = setTimeout(() => reject(new Error("timeout")), 10_000);
        ws.onmessage = (e) => {
          first = String(e.data);
          ws.send("not-a-chat-payload");
        };
        ws.onclose = () => {
          clearTimeout(timer);
          resolve({ url: ws.url, first, closedOnPayload: first.length > 0 });
        };
        ws.onerror = () => reject(new Error("ws error"));
      }),
  );
  expect(result.url).toBe(`wss://localhost:${process.env.PUBLIC_PORT ?? "3443"}/signal`);
  expect(JSON.parse(result.first)).toEqual({ type: "ready" });
  // the bootstrap endpoint accepts nothing: any payload closes the socket
  expect(result.closedOnPayload).toBe(true);
});
