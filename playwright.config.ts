import { defineConfig, devices } from "@playwright/test";

const browserPort = process.env.PLAYWRIGHT_PORT ?? "3000";
if (!/^\d{2,5}$/.test(browserPort))
  throw new Error("PLAYWRIGHT_PORT must be a valid local port");
const browserOrigin = `http://127.0.0.1:${browserPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: browserOrigin,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium-mobile", use: { ...devices["Pixel 7"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `pnpm run build && PORT=${browserPort} APP_ORIGIN=${browserOrigin} pnpm run start`,
    url: `${browserOrigin}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
