import { defineConfig, devices } from "@playwright/test";

const browserPort = process.env.PLAYWRIGHT_PORT ?? "3000";
const learningPort = process.env.PLAYWRIGHT_LEARNING_PORT ?? "3001";
const secure = process.env.PLAYWRIGHT_HTTPS === "true";
if (!/^\d{2,5}$/.test(browserPort))
  throw new Error("PLAYWRIGHT_PORT must be a valid local port");
if (!/^\d{2,5}$/.test(learningPort))
  throw new Error("PLAYWRIGHT_LEARNING_PORT must be a valid local port");
const protocol = secure ? "https" : "http";
const browserOrigin = `${protocol}://127.0.0.1:${browserPort}`;
const learningOrigin = `${protocol}://127.0.0.1:${learningPort}`;
const secureServerPrefix = secure
  ? "pnpm run tls:local && UPSKILL_TLS_CERT_FILE=.local/tls/localhost.crt UPSKILL_TLS_KEY_FILE=.local/tls/localhost.key NODE_EXTRA_CA_CERTS=.local/tls/upskill-local-ca.crt "
  : "";
const testProxyPrefix = "UPSKILL_TRUST_PROXY=true ";
const scormJourney = /learners run SCORM inside the course workspace/u;
const administratorJourney =
  /platform administrators can inspect learner progress/u;
const extendedJourneys = new RegExp(
  `${scormJourney.source}|${administratorJourney.source}`,
  "u",
);
const chromiumMobile = {
  ...devices["Pixel 7"],
  // Simulate distinct clients behind the trusted local reverse proxy so
  // cross-browser sign-ins do not share BetterAuth's per-IP test bucket.
  extraHTTPHeaders: { "x-real-ip": "192.0.2.10" },
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: browserOrigin,
    ignoreHTTPSErrors: secure,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-mobile",
      grepInvert: extendedJourneys,
      use: chromiumMobile,
    },
    {
      name: "firefox",
      grepInvert: extendedJourneys,
      use: {
        ...devices["Desktop Firefox"],
        extraHTTPHeaders: { "x-real-ip": "192.0.2.11" },
      },
    },
    {
      name: "webkit",
      grepInvert: extendedJourneys,
      use: {
        ...devices["Desktop Safari"],
        extraHTTPHeaders: { "x-real-ip": "192.0.2.12" },
      },
    },
    {
      name: "chromium-mobile-scorm",
      dependencies: ["chromium-mobile", "firefox", "webkit"],
      grep: scormJourney,
      use: {
        ...chromiumMobile,
        extraHTTPHeaders: { "x-real-ip": "192.0.2.20" },
      },
    },
    {
      name: "chromium-mobile-admin",
      dependencies: ["chromium-mobile-scorm"],
      grep: administratorJourney,
      use: {
        ...chromiumMobile,
        extraHTTPHeaders: { "x-real-ip": "192.0.2.21" },
      },
    },
  ],
  webServer: {
    command: `pnpm run build && ${secureServerPrefix}${testProxyPrefix}APP_ORIGIN=${browserOrigin} LEARNING_ORIGIN=${learningOrigin} pnpm run start:origins`,
    ignoreHTTPSErrors: secure,
    url: `${browserOrigin}/api/health`,
    // Reusing a developer server can direct browser mutations at the normal
    // local database instead of the disposable test database.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
