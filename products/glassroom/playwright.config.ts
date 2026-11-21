import { defineConfig } from "@playwright/test";

const PUBLIC_PORT = process.env.PUBLIC_PORT ?? "3443";
const BASE_URL = `https://localhost:${PUBLIC_PORT}`;

export default defineConfig({
	fullyParallel: false,
	projects: [
		{
			name: "chromium",
			use: {
				browserName: "chromium",
				launchOptions: process.env.CHROMIUM_PATH
					? { executablePath: process.env.CHROMIUM_PATH }
					: {},
			},
		},
	],
	reporter: [
		["list"],
		["html", { open: "never", outputFolder: "evidence/playwright-report" }],
	],
	testDir: "tests/e2e",
	use: {
		baseURL: BASE_URL,
		ignoreHTTPSErrors: true,
		trace: "retain-on-failure",
	},
	webServer: process.env.PW_NO_WEBSERVER
		? undefined
		: {
				command: "bun run dev:https",
				ignoreHTTPSErrors: true,
				reuseExistingServer: true,
				timeout: 120_000,
				url: BASE_URL,
			},
	workers: 1,
});
