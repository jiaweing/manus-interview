export const requiredPermissions = [
	"sidePanel",
	"activeTab",
	"scripting",
	"tabs",
	"storage",
];

export const optionalDemoOrigins = [
	"https://en.wikipedia.org/*",
	"https://httpbin.org/*",
];

export function proxyHostPermission(proxyUrl = "http://localhost:8787") {
	const url = new URL(proxyUrl);
	const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(
		url.hostname
	);
	if (
		(url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) ||
		url.username ||
		url.password ||
		url.hostname.includes("*")
	) {
		throw new Error(
			"SIDEKICK_PROXY_URL must be HTTPS (HTTP loopback is allowed for development), without credentials or wildcards"
		);
	}
	return `${url.origin}/*`;
}
