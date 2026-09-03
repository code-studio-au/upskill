import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createDisposablePostgresDatabase } from "./disposable-postgres.mjs";

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
      "--grep=secure local origin negotiates compression",
    ],
  ],
};

if (!Object.hasOwn(browserSuites, suite))
  throw new Error(`Unknown browser-test suite: ${suite}`);

const baseDatabaseUrl = process.env.DATABASE_URL;

async function findAvailablePort(excludedPort) {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a browser-test port"));
        return;
      }
      const port = String(address.port);
      server.close((error) => {
        if (error) reject(error);
        else if (port === excludedPort)
          void findAvailablePort(excludedPort).then(resolve, reject);
        else resolve(port);
      });
    });
  });
}

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

  const browserPort =
    process.env.PLAYWRIGHT_PORT ?? (await findAvailablePort(undefined));
  const learningPort =
    process.env.PLAYWRIGHT_LEARNING_PORT ??
    (await findAvailablePort(browserPort));
  if (browserPort === learningPort)
    throw new Error(
      "Browser and learning test origins must use distinct ports",
    );
  const testEnvironment = {
    ...process.env,
    APP_ENV: "test",
    LIVEKIT_ENABLED: "false",
    LIVEKIT_PROJECT_ENVIRONMENT: "test",
    ACCESS_CODE_ENCRYPTION_KEY: "bG9jYWwtb25seS11cHNraWxsLWFjY2Vzcy1rZXktdjE",
    DATABASE_URL: disposableDatabase.databaseUrl,
    PLAYWRIGHT_PORT: browserPort,
    PLAYWRIGHT_LEARNING_PORT: learningPort,
    PLAYWRIGHT_HTTPS: suite === "https" ? "true" : process.env.PLAYWRIGHT_HTTPS,
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
