import { defineConfig, devices } from "@playwright/test";
const origin = process.env.EMBOSS_TEST_ORIGIN ?? "http://127.0.0.1:8787";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 10000 },
  retries: 0,
  reporter: "list",
  use: {
    baseURL: origin,
    trace: "retain-on-failure",
    actionTimeout: 15000,
    navigationTimeout: 20000,
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm preview:start",
    url: `${origin}/admin/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
