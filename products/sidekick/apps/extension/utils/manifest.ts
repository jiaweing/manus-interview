import { validateProxyUrl } from "../../../packages/config/src/proxy-url";

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

export function proxyHostPermission(
	proxyUrl?: string,
	production = false
): string {
	return `${validateProxyUrl(proxyUrl, production)}/*`;
}
