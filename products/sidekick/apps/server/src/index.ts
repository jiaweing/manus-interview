import { createProxyApp } from "./agent/app";
import { loadProxyConfig } from "./agent/config";
import { createOpenRouterAdapter } from "./agent/openrouter";

const config = loadProxyConfig(process.env);
const app = createProxyApp(config, createOpenRouterAdapter(process.env));

export default {
	fetch: app.fetch,
	hostname: "0.0.0.0",
	port: config.port,
};
