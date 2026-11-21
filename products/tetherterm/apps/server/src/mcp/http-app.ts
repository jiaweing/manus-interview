import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { createMcpServer } from "./server";

/** Install guard middleware on the supplied app before mounting these routes. */
export function createMcpHttpApp(app = new Hono()) {
	app.all("/mcp", async (context) => {
		// Stateless JSON response mode: never reuse a transport across requests.
		// Future terminal storage belongs outside this request/connection lifetime.
		const server = createMcpServer();
		const transport = new WebStandardStreamableHTTPServerTransport({
			enableJsonResponse: true,
			sessionIdGenerator: undefined,
		});
		server.server.onerror = () =>
			console.error("TetherTerm HTTP transport error");
		try {
			await server.connect(transport);
			return await transport.handleRequest(context.req.raw);
		} finally {
			await server.close();
		}
	});
	return app;
}
