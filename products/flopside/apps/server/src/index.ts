import { websocket } from "hono/bun";
import { app } from "./app";

const port = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error("SERVER_PORT must be an integer between 1 and 65535");
}

const server = Bun.serve({
	fetch: app.fetch,
	hostname: process.env.HOST ?? "127.0.0.1",
	port,
	websocket,
});

console.info(`Flopside server listening at ${server.url}`);

function shutdown() {
	server.stop(true);
	process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
