import { expect, test } from "bun:test";
import { validateProxyUrl } from "../../../packages/config/src/proxy-url";

test("HTTPS hosting gate: reachable turn shell authenticates without a model call", async () => {
	const origin = process.env.SIDEKICK_PROXY_URL;
	const token = process.env.SIDEKICK_DEMO_TOKEN;
	if (!(origin && token)) {
		throw new Error(
			"HTTPS hosting gate FAILED: smoke requests not run; privately supply SIDEKICK_PROXY_URL (HTTPS) and SIDEKICK_DEMO_TOKEN. An absent HTTPS host is a failing gate, not a passing skip."
		);
	}
	let endpoint: string;
	try {
		endpoint = `${validateProxyUrl(origin, true)}/v1/agent/turn`;
	} catch {
		// biome-ignore lint/style/useErrorCause: Never expose URL parse errors or credentials in test output.
		throw new Error(
			"HTTPS hosting gate FAILED: SIDEKICK_PROXY_URL must be an HTTPS origin without credentials, path, or query."
		);
	}
	const attempts = [
		{ authorization: `Bearer ${token}`, expected: 400 },
		{ authorization: undefined, expected: 401 },
		{ authorization: `Bearer ${token}x`, expected: 401 },
	];
	await Promise.all(
		attempts.map(async (attempt) => {
			let response: Response;
			try {
				const headers = new Headers({
					"Content-Type": "application/json",
					Origin: "chrome-extension://smoke-test",
				});
				if (attempt.authorization) {
					headers.set("Authorization", attempt.authorization);
				}
				response = await fetch(endpoint, {
					body: "{}",
					headers,
					method: "POST",
					redirect: "manual",
					signal: AbortSignal.timeout(15_000),
				});
			} catch {
				// biome-ignore lint/style/useErrorCause: Network errors can contain the URL; intentionally discard them.
				throw new Error(
					"HTTPS hosting gate FAILED: request could not reach the HTTPS proxy within 15 seconds; inspect hosting privately."
				);
			}
			expect(response.status).toBe(attempt.expected);
			await response.body?.cancel();
		})
	);
}, 20_000);
