import { defineConfig, devices } from "@playwright/test";

const applicationPort =
  process.env.PLAYWRIGHT_OFFLINE_SCORM_APPLICATION_PORT ?? "3300";
const learningPort =
  process.env.PLAYWRIGHT_OFFLINE_SCORM_LEARNING_PORT ?? "3301";
const packagePort = process.env.PLAYWRIGHT_OFFLINE_SCORM_PACKAGE_PORT ?? "3302";
for (const [name, port] of Object.entries({
  applicationPort,
  learningPort,
  packagePort,
}))
  if (!/^\d{2,5}$/u.test(port)) throw new Error(`${name} must be a valid port`);

const applicationOrigin = `http://127.0.0.1:${applicationPort}`;
const learningOrigin = `http://127.0.0.1:${learningPort}`;
const packageOrigin = `http://127.0.0.2:${packagePort}`;
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
    url: `${applicationOrigin}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
