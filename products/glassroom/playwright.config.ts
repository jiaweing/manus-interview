import { defineConfig } from "@playwright/test";

const PUBLIC_PORT = process.env.PUBLIC_PORT ?? "3443";
const BASE_URL = `https://localhost:${PUBLIC_PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "evidence/playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
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
  webServer: process.env.PW_NO_WEBSERVER
    ? undefined
    : {
        command: "bun run dev:https",
        url: BASE_URL,
        ignoreHTTPSErrors: true,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
