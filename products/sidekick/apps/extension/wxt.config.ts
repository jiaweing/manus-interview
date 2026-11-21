import { defineConfig } from "wxt";
import { validateProxyUrl } from "../../packages/config/src/proxy-url";
import {
	optionalDemoOrigins,
	proxyHostPermission,
	requiredPermissions,
} from "./utils/manifest";

const production = process.env.NODE_ENV === "production";
const publicProxyUrl = validateProxyUrl(
	process.env.WXT_SIDEKICK_PROXY_URL,
	production
);

export default defineConfig({
	manifest: {
		action: { default_title: "Open Sidekick" },
		host_permissions: [proxyHostPermission(publicProxyUrl, production)],
		minimum_chrome_version: "116",
		name: "Sidekick",
		optional_host_permissions: optionalDemoOrigins,
		permissions: requiredPermissions,
	},
	manifestVersion: 3,
	modules: ["@wxt-dev/module-react"],
	vite: () => ({
		define: {
			"import.meta.env.WXT_SIDEKICK_PROXY_URL": JSON.stringify(publicProxyUrl),
		},
	}),
});
