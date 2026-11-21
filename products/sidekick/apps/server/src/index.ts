import { createProxyApp } from "./agent/app";
import { loadProxyConfig } from "./agent/config";

const config = loadProxyConfig(process.env);
const app = createProxyApp(config);

export default {
	fetch: app.fetch,
	hostname: "0.0.0.0",
	port: config.port,
};
