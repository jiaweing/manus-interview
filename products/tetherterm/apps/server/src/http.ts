import { createMcpHttpApp } from "./mcp/http-app";

export function startHttpServer(port = Number(Bun.env.PORT ?? "3000")) {
	const app = createMcpHttpApp();
	const server = Bun.serve({
		fetch: app.fetch,
		hostname: "127.0.0.1",
		port,
	});
	console.error(
		`TetherTerm MCP listening on http://127.0.0.1:${server.port}/mcp`
	);
	return server;
}

if (import.meta.main) {
	try {
		const server = startHttpServer();
		const shutdown = () => server.stop(true);
		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
	} catch {
		console.error("TetherTerm HTTP startup failed");
		process.exitCode = 1;
	}
}
