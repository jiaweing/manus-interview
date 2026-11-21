import { defineConfig } from "wxt";
import { validateProxyUrl } from "../../packages/config/src/proxy-url";

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
	modules: ["@wxt-dev/module-react"],
	vite: () => ({
		define: {
			"import.meta.env.WXT_SIDEKICK_PROXY_URL": JSON.stringify(
				validateProxyUrl(
					process.env.WXT_SIDEKICK_PROXY_URL,
					process.env.NODE_ENV === "production"
				)
			),
		},
	}),
});
