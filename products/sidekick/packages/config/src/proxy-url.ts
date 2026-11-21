const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Validate an origin without ever including the supplied value in an error. */
export function validateProxyUrl(
	value: string | undefined,
	production: boolean
): string {
	if (production && !value) {
		throw new Error("SIDEKICK_PROXY_URL is required in production");
	}
	let url: URL;
	try {
		url = new URL(value ?? "http://localhost:8787");
	} catch {
		// biome-ignore lint/style/useErrorCause: URL parse errors can include credentials; never retain them as an error cause.
		throw new Error("Proxy URL must be a valid HTTP(S) origin");
	}
	if (
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/" ||
		(url.protocol !== "https:" &&
			!(
				url.protocol === "http:" &&
				!production &&
				LOOPBACK_HOSTS.has(url.hostname)
			))
	) {
		throw new Error(
			"Proxy URL must be HTTPS; only loopback HTTP is allowed in development"
		);
	}
	return url.origin;
}
