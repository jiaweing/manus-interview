import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "evidence/playwright-report" }]],
  use: {
    baseURL: "https://localhost:3443",
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
        url: "https://localhost:3443",
        ignoreHTTPSErrors: true,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
