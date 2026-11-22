import { defineConfig } from "@playwright/test";

const baseURL = `http://127.0.0.1:${process.env.AI0_TEST_CONSOLE_PORT ?? "4183"}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 90_000,
  use: {
    baseURL,
    browserName: "chromium",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node tests/start-console.mjs",
    url: `${baseURL}/healthz`,
    timeout: 90_000
  }
});
