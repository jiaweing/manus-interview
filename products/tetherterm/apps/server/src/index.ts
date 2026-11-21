import { Hono } from "hono";
import { requireSetsid } from "./pty/spawn";

export const app = new Hono();

// Boot probe only; the authenticated MCP transport is implemented by issue #102.
app.get("/healthz", (context) => context.text("ok"));

if (import.meta.main) {
	requireSetsid();
	const server = Bun.serve({
		fetch: app.fetch,
		hostname: "127.0.0.1",
		port: Number(Bun.env.PORT ?? "3000"),
	});
	console.error(`TetherTerm listening on http://127.0.0.1:${server.port}`);
}
