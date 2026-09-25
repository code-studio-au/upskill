import { spawn } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveBrowserTestPorts } from "./browser-test-ports.mjs";
import { createDisposablePostgresDatabase } from "./disposable-postgres.mjs";
import { ensureLocalTls } from "./local-tls.mjs";

const suite = process.argv[2] ?? "all";
const playwright = path.resolve("node_modules/@playwright/test/cli.js");
const browserSuites = {
  all: [["test"]],
  core: [
    [
      "test",
      "--project=chromium-mobile",
      "--project=firefox",
      "--project=webkit",
    ],
  ],
  scorm: [["test", "--project=chromium-mobile-scorm", "--no-deps"]],
  admin: [["test", "--project=chromium-mobile-admin", "--no-deps"]],
  https: [
    [
      "test",
      "--project=chromium-mobile",
      "--grep=secure local origin negotiates compression|the application shell provides a public offline fallback",
    ],
  ],
};

if (!Object.hasOwn(browserSuites, suite))
  throw new Error(`Unknown browser-test suite: ${suite}`);

const baseDatabaseUrl = process.env.DATABASE_URL;
const secure = suite === "https" || process.env.PLAYWRIGHT_HTTPS === "true";

async function localTlsSpkiPin() {
  const { certificate } = await ensureLocalTls();
  const parsedCertificate = new X509Certificate(await readFile(certificate));
  const publicKey = parsedCertificate.publicKey.export({
    format: "der",
    type: "spki",
  });
  return createHash("sha256").update(publicKey).digest("base64");
}

const tlsSpkiPin = secure ? await localTlsSpkiPin() : undefined;

let activeChild;
let interruptedSignal;

function run(command, arguments_, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      env: environment,
      stdio: "inherit",
    });
    activeChild = child;
    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      activeChild = undefined;
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      activeChild = undefined;
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${path.basename(command)} exited ${signal ? `with ${signal}` : `with code ${String(code)}`}`,
          ),
        );
    });
  });
}

for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    interruptedSignal = signal;
    if (activeChild?.exitCode === null) activeChild.kill(signal);
  });

let runError;
let disposableDatabase;
try {
  disposableDatabase = await createDisposablePostgresDatabase({
    baseDatabaseUrl,
    namePrefix: "upskill_e2e",
  });
  console.log(
    `Created disposable browser-test database ${disposableDatabase.databaseName}`,
  );

  const { browserPort, learningPort, offlineScormPackagePort } =
    await resolveBrowserTestPorts({
      browserPort: process.env.PLAYWRIGHT_PORT,
      learningPort: process.env.PLAYWRIGHT_LEARNING_PORT,
      offlineScormPackagePort:
        process.env.PLAYWRIGHT_OFFLINE_SCORM_PACKAGE_PORT,
    });
  const testEnvironment = {
    ...process.env,
    APP_ENV: "test",
    LIVEKIT_ENABLED: "false",
    LIVEKIT_PROJECT_ENVIRONMENT: "test",
    ACCESS_CODE_ENCRYPTION_KEY: "bG9jYWwtb25seS11cHNraWxsLWFjY2Vzcy1rZXktdjE",
    DATABASE_URL: disposableDatabase.databaseUrl,
    PLAYWRIGHT_PORT: browserPort,
    PLAYWRIGHT_LEARNING_PORT: learningPort,
    PLAYWRIGHT_OFFLINE_SCORM_PACKAGE_PORT: offlineScormPackagePort,
    PLAYWRIGHT_HTTPS: secure ? "true" : process.env.PLAYWRIGHT_HTTPS,
    ...(tlsSpkiPin ? { PLAYWRIGHT_TLS_SPKI_PIN: tlsSpkiPin } : {}),
  };

  for (const script of [
    "src/server/db/migrate.ts",
    "scripts/seed-catalog.ts",
    "scripts/seed-learner.ts",
  ]) {
    if (interruptedSignal) break;
    await run(process.execPath, ["--import", "tsx", script], testEnvironment);
  }
  for (const arguments_ of browserSuites[suite]) {
    if (interruptedSignal) break;
    await run(process.execPath, [playwright, ...arguments_], testEnvironment);
  }
} catch (error) {
  runError = error;
} finally {
  if (disposableDatabase)
    try {
      await disposableDatabase.dispose();
      console.log(
        `Dropped disposable browser-test database ${disposableDatabase.databaseName}`,
      );
    } catch (cleanupError) {
      if (runError)
        console.error("Browser-test database cleanup failed", cleanupError);
      else runError = cleanupError;
    }
}

if (interruptedSignal)
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
else if (runError) throw runError;
