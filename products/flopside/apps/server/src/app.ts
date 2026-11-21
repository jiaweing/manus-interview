import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { createIngressProbe } from "./ingress-probe";
import { createRoomRoutes } from "./room-routes";
import { RoomStore } from "./rooms";

interface AppOptions {
	allowedOrigins?: string[];
	roomStore?: RoomStore;
	webRoot?: string;
}

export function createApp({
	allowedOrigins = [],
	roomStore = new RoomStore(),
	webRoot,
}: AppOptions = {}) {
	const application = new Hono();
	application.route("/api/rooms", createRoomRoutes(roomStore));
	application.get(
		"/api/ws",
		async (c, next) => {
			if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
				return c.text("WebSocket upgrade required", 426);
			}
			const origin = c.req.header("origin");
			const sameOrigin = new URL(c.req.url).origin;
			if (
				!origin ||
				(origin !== sameOrigin && !allowedOrigins.includes(origin))
			) {
				return c.text("Origin not allowed", 403);
			}
			await next();
		},
		createIngressProbe(),
		(c) => c.text("WebSocket upgrade required", 426)
	);
	if (webRoot) {
		application.get("*", serveStatic({ root: webRoot }));
		application.get(
			"*",
			serveStatic({
				rewriteRequestPath: (path) => `${path}.html`,
				root: webRoot,
			})
		);
	} else {
		application.get("/", (c) => c.text("OK"));
	}
	return application;
}

export const app = createApp();
