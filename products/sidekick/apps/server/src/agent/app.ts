import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ProxyConfig } from "./config";
import { bearerAuth, requestRateLimit } from "./security";

/** Envelope only; #79 owns full protocol validation and the provider adapter. */
export interface TurnRequest {
	goal: string;
	messages: unknown[];
	snapshot: Record<string, unknown>;
}

export interface TurnAdapter {
	turn: (request: TurnRequest, signal: AbortSignal) => Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTurnRequest(value: unknown): value is TurnRequest {
	return (
		isRecord(value) &&
		typeof value.goal === "string" &&
		value.goal.trim().length > 0 &&
		Array.isArray(value.messages) &&
		isRecord(value.snapshot)
	);
}

class BodyTooLargeError extends Error {}

async function readBoundedBody(
	request: Request,
	maxBytes: number
): Promise<string> {
	const declared = request.headers.get("Content-Length");
	if (declared && Number(declared) > maxBytes) {
		throw new BodyTooLargeError();
	}
	if (!request.body) {
		return "";
	}
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			// biome-ignore lint/performance/noAwaitInLoops: A single stream reader must consume chunks sequentially to enforce the byte cap.
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			size += value.byteLength;
			if (size > maxBytes) {
				// Do not wait for a malicious streaming producer to finish cancellation.
				reader.cancel().catch(() => undefined);
				throw new BodyTooLargeError();
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function createProxyApp(
	config: ProxyConfig,
	adapter?: TurnAdapter,
	now: () => number = Date.now
) {
	const app = new Hono();
	// No Hono logger, evlog, body/header logging, or raw error serialization.
	// Override Hono's default error handler, which would print adapter errors.
	app.onError(
		() =>
			new Response('{"error":"Internal server error"}', {
				headers: {
					"Cache-Control": "no-store",
					"Content-Type": "application/json",
				},
				status: 500,
			})
	);
	app.use("*", async (c, next) => {
		c.header("Cache-Control", "no-store");
		c.header("X-Content-Type-Options", "nosniff");
		await next();
	});
	app.get("/", (c) => c.text("OK"));
	// Preflight is transport permission only. Every POST still requires bearer auth.
	app.use(
		"/v1/agent/turn",
		cors({
			allowHeaders: ["Authorization", "Content-Type"],
			allowMethods: ["POST"],
			origin: "*",
		})
	);
	app.post(
		"/v1/agent/turn",
		bearerAuth(config.demoToken),
		requestRateLimit(config, now),
		async (c) => {
			let body: unknown;
			try {
				const text = await readBoundedBody(c.req.raw, config.maxBodyBytes);
				if (
					c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase() !==
					"application/json"
				) {
					return c.json({ error: "Expected a JSON turn request" }, 400);
				}
				body = JSON.parse(text);
			} catch (error) {
				if (error instanceof BodyTooLargeError) {
					return c.json({ error: "Request body too large" }, 413);
				}
				return c.json({ error: "Invalid turn request" }, 400);
			}
			if (!isTurnRequest(body)) {
				return c.json({ error: "Invalid turn request" }, 400);
			}
			if (!adapter) {
				return c.json({ error: "Turn adapter is not configured" }, 501);
			}
			const result = await adapter.turn(body, c.req.raw.signal);
			return c.json(result);
		}
	);
	return app;
}
