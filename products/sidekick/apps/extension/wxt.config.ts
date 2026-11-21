import { defineConfig } from "wxt";
import {
	optionalDemoOrigins,
	proxyHostPermission,
	requiredPermissions,
} from "./utils/manifest";

export default defineConfig({
	manifest: {
		action: { default_title: "Open Sidekick" },
		host_permissions: [proxyHostPermission(process.env.SIDEKICK_PROXY_URL)],
		minimum_chrome_version: "116",
		name: "Sidekick",
		optional_host_permissions: optionalDemoOrigins,
		permissions: requiredPermissions,
	},
	manifestVersion: 3,
	modules: ["@wxt-dev/module-react"],
});
