import { defineConfig, devices } from "@playwright/test";

const applicationPort =
  process.env.PLAYWRIGHT_OFFLINE_SCORM_APPLICATION_PORT ?? "3300";
if (!/^\d{2,5}$/u.test(applicationPort))
  throw new Error("applicationPort must be a valid port");

const applicationOrigin = `http://app.localhost:${applicationPort}`;
const learningOrigin = `http://learn.localhost:${applicationPort}`;
const packageOrigin = `http://p-prototype.localhost:${applicationPort}`;
const serverEnvironment = [
  `OFFLINE_SCORM_PROTOTYPE_APP_ORIGIN=${applicationOrigin}`,
  `OFFLINE_SCORM_PROTOTYPE_LEARNING_ORIGIN=${learningOrigin}`,
  `OFFLINE_SCORM_PROTOTYPE_ORIGIN=${packageOrigin}`,
].join(" ");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "offline-scorm-package-prototype.spec.ts",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: applicationOrigin,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: `${serverEnvironment} node scripts/start-offline-scorm-package-prototype.mjs`,
    url: `http://127.0.0.1:${applicationPort}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
