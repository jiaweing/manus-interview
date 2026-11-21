import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, defineConfig, devices } from "playwright/test";

const productRoot = fileURLToPath(new URL("../../", import.meta.url));
const baseURL =
	process.env.E2E_BASE_URL ??
	`http://127.0.0.1:${process.env.WEB_PORT ?? process.env.PORT ?? 3000}`;
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
if (
	!(executablePath || existsSync(chromium.executablePath())) &&
	existsSync("/usr/bin/chromium")
) {
	executablePath = "/usr/bin/chromium";
}

export default defineConfig({
	fullyParallel: false,
	outputDir: `${productRoot}test-results`,
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } },
		},
	],
	reporter: "list",
	retries: 0,
	testDir: fileURLToPath(new URL("./tests/", import.meta.url)),
	timeout: 30_000,
	use: { baseURL, viewport: { height: 720, width: 1280 } },
	// An explicit E2E_BASE_URL opts into an already-running production build.
	// Otherwise boot exactly the product's one-instance production command.
	webServer: process.env.E2E_BASE_URL
		? undefined
		: {
				command: "bun run start",
				cwd: productRoot,
				env: { HOST: "127.0.0.1", WEB_PORT: new URL(baseURL).port || "80" },
				reuseExistingServer: false,
				stderr: "pipe",
				stdout: "pipe",
				timeout: 30_000,
				url: baseURL,
			},
	workers: 1,
});
