import { Hono } from "hono";
import { loadConfig } from "./config";
import { ConfigurationError } from "./errors";
import { requireSetsid } from "./pty/spawn";
import { reportStartupFailure } from "./startup";

export const app = new Hono();

// Retain the original boot probe; the MCP launcher lives in http.ts.
app.get("/healthz", (context) => context.text("ok"));

if (import.meta.main) {
	try {
		const config = await loadConfig("http");
		try {
			requireSetsid();
		} catch {
			// biome-ignore lint/style/useErrorCause: Never expose raw platform errors at startup.
			throw new ConfigurationError(
				"native PTYs require util-linux setsid on PATH and Linux; install util-linux before starting the server"
			);
		}
		const server = Bun.serve({
			fetch: app.fetch,
			hostname: config.hostname,
			port: config.port,
		});
		console.error(
			`TetherTerm listening on http://${config.hostname}:${server.port}`
		);
		const shutdown = () => server.stop(true);
		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
	} catch (error) {
		reportStartupFailure("HTTP", error);
	}
}
