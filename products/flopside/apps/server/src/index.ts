import { fileURLToPath } from "node:url";
import { websocket } from "hono/bun";
import { createApp } from "./app";

// Bun build folds process.env.NODE_ENV; Bun.env keeps this a runtime decision.
const production = Bun.env.NODE_ENV === "production";
const hostname = process.env.HOST ?? "127.0.0.1";
// In production WEB_PORT is the single browser/WS listener; SERVER_PORT is dev-only.
const port = Number(
	production
		? (process.env.WEB_PORT ?? process.env.PORT ?? 3000)
		: (process.env.SERVER_PORT ?? process.env.PORT ?? 3001)
);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error("Listener port must be an integer between 1 and 65535");
}
const webRoot = production
	? fileURLToPath(new URL("../../web/out/", import.meta.url))
	: undefined;
if (webRoot && !(await Bun.file(`${webRoot}index.html`).exists())) {
	throw new Error("Missing Next static export; run bun run build before start");
}
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
	.split(",")
	.map((origin) => origin.trim())
	.filter(Boolean);
if (!production) {
	allowedOrigins.push(`http://${hostname}:${process.env.WEB_PORT ?? 3000}`);
}
const app = createApp({ allowedOrigins, webRoot });
const server = Bun.serve({
	fetch: app.fetch,
	hostname,
	port,
	websocket,
});
console.info(
	`Flopside server listening at ${server.url} (${production ? "production: static Next + WS, instances=1" : "development"})`
);
function shutdown() {
	server.stop(true);
	process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
