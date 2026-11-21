import { type Environment, loadConfig, type ServerConfig } from "./config";
import { ConfigurationError } from "./errors";
import { createGuardedHttpApp } from "./http-guard";
import { requireSetsid } from "./pty/spawn";
import { reportStartupFailure } from "./startup";

export function createBootApp(
	config: ServerConfig,
	env: Environment,
	boundPort: () => number
) {
	const app = createGuardedHttpApp(config, env, boundPort);
	// Retain the original boot probe; the MCP launcher lives in http.ts.
	app.get("/healthz", (context) => context.text("ok"));
	return app;
}

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
		let boundPort = config.port;
		const app = createBootApp(config, process.env, () => boundPort);
		const server = Bun.serve({
			fetch: app.fetch,
			hostname: config.hostname,
			port: config.port,
		});
		if (server.port === undefined) {
			await server.stop(true);
			throw new ConfigurationError("HTTP requires a bound TCP port");
		}
		boundPort = server.port;
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
