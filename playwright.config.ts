import { defineConfig, devices } from "@playwright/test";

const browserPort = process.env.PLAYWRIGHT_PORT ?? "3000";
const learningPort = process.env.PLAYWRIGHT_LEARNING_PORT ?? "3001";
if (!/^\d{2,5}$/.test(browserPort))
  throw new Error("PLAYWRIGHT_PORT must be a valid local port");
if (!/^\d{2,5}$/.test(learningPort))
  throw new Error("PLAYWRIGHT_LEARNING_PORT must be a valid local port");
const browserOrigin = `http://127.0.0.1:${browserPort}`;
const learningOrigin = `http://127.0.0.1:${learningPort}`;

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
    command: `pnpm run build && APP_ORIGIN=${browserOrigin} LEARNING_ORIGIN=${learningOrigin} pnpm run start:origins`,
    url: `${browserOrigin}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
