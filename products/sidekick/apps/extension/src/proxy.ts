import { validateProxyUrl } from "../../../packages/config/src/proxy-url";

/** Public build-time origin only; tokens are supplied at runtime by #80/#88. */
export const proxyUrl = validateProxyUrl(
	import.meta.env.WXT_SIDEKICK_PROXY_URL,
	false
);
