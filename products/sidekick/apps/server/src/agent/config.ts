import { validateProxyUrl } from "../../../../packages/config/src/proxy-url";

const POSITIVE_INTEGER = /^\d+$/;
const WHITESPACE = /\s/;

export interface ProxyConfig {
	demoToken: string;
	maxBodyBytes: number;
	port: number;
	publicUrl: string;
	rateLimitMaxRequests: number;
	rateLimitWindowMs: number;
}

type Environment = Record<string, string | undefined>;

function positiveInteger(
	env: Environment,
	name: string,
	fallback: number
): number {
	const raw = env[name];
	if (raw === undefined) {
		return fallback;
	}
	const value = Number(raw);
	if (
		!(POSITIVE_INTEGER.test(raw) && Number.isSafeInteger(value)) ||
		value <= 0
	) {
		throw new Error(`${name} must be a positive safe integer`);
	}
	return value;
}

export function loadProxyConfig(env: Environment): ProxyConfig {
	const demoToken = env.SIDEKICK_DEMO_TOKEN;
	if (!demoToken || WHITESPACE.test(demoToken)) {
		throw new Error(
			"SIDEKICK_DEMO_TOKEN is required and must not contain whitespace"
		);
	}
	const port = positiveInteger(env, "PORT", 8787);
	if (port > 65_535) {
		throw new Error("PORT must be at most 65535");
	}
	return {
		demoToken,
		maxBodyBytes: positiveInteger(env, "SIDEKICK_MAX_BODY_BYTES", 131_072),
		port,
		publicUrl: validateProxyUrl(
			env.SIDEKICK_PROXY_URL,
			env.NODE_ENV === "production"
		),
		rateLimitMaxRequests: positiveInteger(
			env,
			"SIDEKICK_RATE_LIMIT_MAX_REQUESTS",
			60
		),
		rateLimitWindowMs: positiveInteger(
			env,
			"SIDEKICK_RATE_LIMIT_WINDOW_MS",
			60_000
		),
	};
}
