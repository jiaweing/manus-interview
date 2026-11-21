import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";

// TEMPORARY, transport-only #28 probe. #49 MUST remove/replace this unauthenticated
// handler with authenticated gameplay before release. Never accept game commands.
// The random boot marker is public evidence, NOT a credential or seat token.
export function createIngressProbe() {
	const bootMarker = crypto.randomUUID();
	// Hono creates a new WSContext wrapper for every callback; raw is stable.
	const connections = new Map<unknown, WSContext>();
	function broadcast() {
		const evidence = { bootMarker, connections: connections.size };
		const message = JSON.stringify(evidence);
		for (const connection of connections.values()) {
			connection.send(message);
		}
		console.info(`Flopside ingress ${message}`);
	}
	return upgradeWebSocket(() => ({
		onClose(_event, socket) {
			connections.delete(socket.raw);
			broadcast();
		},
		onOpen(_event, socket) {
			connections.set(socket.raw, socket);
			broadcast();
		},
		// No onMessage: no payload logging, echo, authentication bypass or gameplay.
	}));
}
