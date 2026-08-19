import { spawn } from "node:child_process";
import path from "node:path";
import { createDisposablePostgresDatabase } from "./disposable-postgres.mjs";

const verificationScripts = [
  "src/server/db/migrate.ts",
  "scripts/verify-migrations.ts",
  "scripts/verify-audit-logging.ts",
  "scripts/verify-access-code-redemption.ts",
  "scripts/verify-course-checkout.ts",
  "scripts/verify-bulk-order-commerce.ts",
  "scripts/verify-learner-workspace.ts",
  "scripts/verify-scorm-attempts.ts",
  "scripts/verify-admin-visibility.ts",
  "scripts/verify-admin-progress-overrides.ts",
  "scripts/verify-admin-enrollment-management.ts",
  "scripts/verify-admin-access-grants.ts",
  "scripts/verify-admin-course-authoring.ts",
  "scripts/verify-survey-workflow.ts",
  "scripts/verify-onboarding-workflow.ts",
  "scripts/verify-resource-library.ts",
  "scripts/verify-completion-certificates.ts",
  "scripts/verify-event-foundation.ts",
  "scripts/verify-email-designer.ts",
  "scripts/verify-offering-communications.ts",
  "scripts/verify-provisional-account-notifications.ts",
];

let activeChild;
let interruptedSignal;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    interruptedSignal = signal;
    if (activeChild?.exitCode === null) activeChild.kill(signal);
  });

function run(script, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", script], {
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
            `${path.basename(script)} exited ${signal ? `with ${signal}` : `with code ${String(code)}`}`,
          ),
        );
    });
  });
}

let runError;
let disposableDatabase;
try {
  disposableDatabase = await createDisposablePostgresDatabase({
    baseDatabaseUrl: process.env.DATABASE_URL,
    namePrefix: "upskill_verify",
  });
  console.log(
    `Created disposable database-verification database ${disposableDatabase.databaseName}`,
  );
  const environment = {
    ...process.env,
    APP_ENV: "test",
    DATABASE_URL: disposableDatabase.databaseUrl,
    EMAIL_PROVIDER: "local_capture",
  };
  for (const script of verificationScripts) {
    if (interruptedSignal) break;
    await run(script, environment);
  }
} catch (error) {
  runError = error;
} finally {
  if (disposableDatabase)
    try {
      await disposableDatabase.dispose();
      console.log(
        `Dropped disposable database-verification database ${disposableDatabase.databaseName}`,
      );
    } catch (cleanupError) {
      if (runError)
        console.error("Database-verification cleanup failed", cleanupError);
      else runError = cleanupError;
    }
}

if (interruptedSignal)
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
else if (runError) throw runError;
