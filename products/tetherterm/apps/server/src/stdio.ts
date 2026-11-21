import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type Environment, loadConfig } from "./config";
import { createMcpServer } from "./mcp/server";
import { reportStartupFailure } from "./startup";

export async function startStdioServer(env: Environment = process.env) {
	await loadConfig("stdio", env);
	const server = createMcpServer();
	const transport = new StdioServerTransport();
	// Do not log request bodies, environment values, or protocol traffic.
	server.server.onerror = () =>
		console.error("TetherTerm stdio transport error");
	await server.connect(transport);
	console.error("TetherTerm MCP ready on stdio");
	return server;
}

if (import.meta.main) {
	try {
		const server = await startStdioServer();
		const shutdown = async () => {
			await server.close();
			process.stdin.pause();
		};
		process.stdin.once("end", shutdown);
		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
	} catch (error) {
		reportStartupFailure("stdio", error);
	}
}
