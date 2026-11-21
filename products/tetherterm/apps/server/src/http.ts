import { type Environment, loadConfig } from "./config";
import { ConfigurationError } from "./errors";
import { createGuardedHttpApp } from "./http-guard";
import { createMcpHttpApp } from "./mcp/http-app";
import { reportStartupFailure } from "./startup";

export async function startHttpServer(env: Environment = process.env) {
	const config = await loadConfig("http", env);
	let boundPort = config.port;
	const app = createMcpHttpApp(
		createGuardedHttpApp(config, env, () => boundPort)
	);
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
		`TetherTerm MCP listening on http://${config.hostname}:${server.port}/mcp`
	);
	return server;
}

if (import.meta.main) {
	try {
		const server = await startHttpServer();
		const shutdown = () => server.stop(true);
		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
	} catch (error) {
		reportStartupFailure("HTTP", error);
	}
}
