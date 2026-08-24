import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { createStripeDevelopmentSetup } from "./stripe-development.mjs";

const requireFromHere = createRequire(import.meta.url);
const viteEntry = path.join(
  path.dirname(requireFromHere.resolve("vite/package.json")),
  "bin",
  "vite.js",
);

async function runMigrations() {
  console.log("Applying pending database migrations...");
  const migration = spawn(
    process.execPath,
    ["--import", "tsx", "src/server/db/migrate.ts"],
    { env: process.env, stdio: "inherit" },
  );
  const result = await new Promise((resolve, reject) => {
    migration.once("error", reject);
    migration.once("close", (code, signal) => resolve({ code, signal }));
  });
  if (result.code !== 0)
    throw new Error(
      `Database migration failed (${result.signal ?? String(result.code)})`,
    );
}

try {
  await runMigrations();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Database migration failed.",
  );
  process.exit(1);
}

let stripeSetup;
try {
  stripeSetup = createStripeDevelopmentSetup();
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Unable to configure Stripe webhook forwarding.",
  );
  process.exit(1);
}

const definitions = [
  {
    script: "dev:web",
    command: process.execPath,
    arguments: [viteEntry, "dev", "--port", "3000", "--strictPort"],
  },
  {
    script: "dev:learning",
    command: process.execPath,
    arguments: [viteEntry, "dev", "--port", "3001", "--strictPort"],
  },
  {
    script: "worker:scorm",
    command: process.execPath,
    arguments: [
      "--watch",
      "--env-file-if-exists=.env.local",
      "--import",
      "tsx",
      "src/worker/scorm-worker.ts",
    ],
  },
];
if (stripeSetup.listener) {
  definitions.push({ ...stripeSetup.listener, required: false });
  console.log(
    "Stripe webhook forwarding enabled for http://localhost:3000/api/stripe/webhook",
  );
} else if (stripeSetup.warning) console.warn(stripeSetup.warning);

const services = definitions.map((definition) => ({
  script: definition.script,
  required: definition.required !== false,
  process: spawn(definition.command, definition.arguments, {
    env: stripeSetup.environment,
    stdio: definition.stdio ?? "inherit",
  }),
}));

let stopping = false;
let remaining = services.length;
let finish;
const finished = new Promise((resolve) => {
  finish = resolve;
});

function stop(exitCode, signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const service of services)
    if (service.process.exitCode === null) service.process.kill(signal);
}

for (const service of services) {
  service.process.once("error", (error) => {
    console.error(`Unable to start ${service.script}: ${error.message}`);
    if (service.required) stop(1);
  });
  service.process.once("close", (code, signal) => {
    remaining -= 1;
    if (!stopping && service.required) {
      if (signal === "SIGINT" || signal === "SIGTERM") stop(0, signal);
      else {
        console.error(
          `${service.script} stopped unexpectedly (${signal ?? String(code)})`,
        );
        stop(code === 0 ? 1 : (code ?? 1));
      }
    } else if (!stopping)
      console.warn(
        `${service.script} stopped; development continues without Stripe webhook forwarding.`,
      );
    if (remaining === 0) finish();
  });
}

process.once("SIGINT", () => stop(0, "SIGINT"));
process.once("SIGTERM", () => stop(0));

await finished;
