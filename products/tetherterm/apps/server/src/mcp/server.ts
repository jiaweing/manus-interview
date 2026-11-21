import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Transport connections own no terminal sessions; tool adapters will be added here. */
export function createMcpServer() {
	return new McpServer(
		{ name: "tetherterm", version: "0.1.0" },
		{ capabilities: { tools: {} } }
	);
}
