import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { ProxyConfig } from "./config";

const BEARER_TOKEN = /^Bearer ([^\s]+)$/i;

export function bearerAuth(demoToken: string): MiddlewareHandler {
	// Both digests are always 32 bytes: no early token-length comparison.
	const expected = createHash("sha256").update(demoToken).digest();
	return async (c, next) => {
		const authorization = c.req.header("Authorization") ?? "";
		const match = BEARER_TOKEN.exec(authorization);
		const supplied = createHash("sha256")
			.update(match?.[1] ?? "")
			.digest();
		const matches = timingSafeEqual(expected, supplied);
		if (!(match && matches)) {
			c.header("WWW-Authenticate", "Bearer");
			return c.json({ error: "Unauthorized" }, 401);
		}
		await next();
	};
}

export function requestRateLimit(
	config: ProxyConfig,
	now: () => number
): MiddlewareHandler {
	// One shared quota for this single-token demo, not a spoofable Origin/IP key.
	// Bounded state; production replicas require a shared limiter at the host.
	let windowStart = now();
	let requests = 0;
	return async (c, next) => {
		const current = now();
		if (current - windowStart >= config.rateLimitWindowMs) {
			windowStart = current;
			requests = 0;
		}
		if (requests >= config.rateLimitMaxRequests) {
			const retrySeconds = Math.max(
				1,
				Math.ceil((windowStart + config.rateLimitWindowMs - current) / 1000)
			);
			c.header("Retry-After", String(retrySeconds));
			return c.json({ error: "Too many requests" }, 429);
		}
		requests += 1;
		await next();
	};
}
