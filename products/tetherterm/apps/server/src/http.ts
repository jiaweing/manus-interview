import { type Environment, loadConfig } from "./config";
import { createMcpHttpApp } from "./mcp/http-app";
import { reportStartupFailure } from "./startup";

export async function startHttpServer(env: Environment = process.env) {
	const config = await loadConfig("http", env);
	const app = createMcpHttpApp();
	const server = Bun.serve({
		fetch: app.fetch,
		hostname: config.hostname,
		port: config.port,
	});
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
