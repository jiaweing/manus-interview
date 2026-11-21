import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp/server";

export async function startStdioServer() {
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
	} catch {
		console.error("TetherTerm stdio startup failed");
		process.exitCode = 1;
	}
}
