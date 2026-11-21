import { createHash, timingSafeEqual } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import type { Environment, ServerConfig } from "./config";
import { ConfigurationError } from "./errors";

const BEARER = /^Bearer ([A-Za-z0-9+/_=-]+)$/i;

/** Install on '*' BEFORE routes: even unknown paths and malformed MCP bodies
 * must pass this boundary. Never read credentials from the URL or log input.
 */
export function createHttpGuard(
	config: ServerConfig,
	env: Environment,
	boundPort: () => number
): MiddlewareHandler {
	const token = config.tokenEnvVar ? env[config.tokenEnvVar] : undefined;
	if (config.mode !== "http" || !config.tunnelHostname || !token) {
		throw new ConfigurationError("HTTP guard requires validated configuration");
	}
	// Hash both operands to fixed-size buffers so timingSafeEqual also handles
	// incorrect token lengths without a secret-dependent length comparison.
	const expected = createHash("sha256").update(token).digest();
	const tunnelHostname = config.tunnelHostname.toLowerCase();
	return async (context, next) => {
		const supplied = BEARER.exec(
			context.req.header("authorization") ?? ""
		)?.[1];
		const actual = createHash("sha256")
			.update(supplied ?? "")
			.digest();
		if (!(timingSafeEqual(actual, expected) && supplied !== undefined)) {
			return context.text("Unauthorized", 401);
		}

		const port = boundPort();
		const localHosts = [
			`127.0.0.1:${port}`,
			`localhost:${port}`,
			`[::1]:${port}`,
		];
		const host = context.req.header("host")?.toLowerCase();
		if (!(host && (localHosts.includes(host) || host === tunnelHostname))) {
			return context.text("Forbidden", 403);
		}
		const origin = context.req.header("origin");
		const approvedOrigins = [
			...localHosts.map((localHost) => `http://${localHost}`),
			`https://${tunnelHostname}`,
		];
		if (origin !== undefined && !approvedOrigins.includes(origin)) {
			return context.text("Forbidden", 403);
		}
		await next();
		// The SDK can reflect invalid protocol-header values in HTTP errors.
		// Preserve its status, but never return raw diagnostics or request data.
		if (context.res.status >= 400) {
			context.res = new Response("Request rejected", {
				headers: { "Content-Type": "text/plain; charset=UTF-8" },
				status: context.res.status,
			});
		}
	};
}

/** No unguarded routes, including 404s, may be mounted before this factory. */
export function createGuardedHttpApp(
	config: ServerConfig,
	env: Environment,
	boundPort: () => number
) {
	const app = new Hono();
	// Hono's default error handler logs the raw error; do not let it echo input.
	app.onError((_error, context) => context.text("Request rejected", 500));
	app.use("*", createHttpGuard(config, env, boundPort));
	return app;
}
