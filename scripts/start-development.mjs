import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const requireFromHere = createRequire(import.meta.url);
const viteEntry = path.join(
  path.dirname(requireFromHere.resolve("vite/package.json")),
  "bin",
  "vite.js",
);

const definitions = [
  {
    script: "dev:web",
    command: process.execPath,
    arguments: [viteEntry, "dev", "--port", "3000"],
  },
  {
    script: "dev:learning",
    command: process.execPath,
    arguments: [viteEntry, "dev", "--port", "3001"],
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

const services = definitions.map((definition) => ({
  script: definition.script,
  process: spawn(definition.command, definition.arguments, {
    stdio: "inherit",
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
    stop(1);
  });
  service.process.once("close", (code, signal) => {
    remaining -= 1;
    if (!stopping) {
      if (signal === "SIGINT" || signal === "SIGTERM") stop(0, signal);
      else {
        console.error(
          `${service.script} stopped unexpectedly (${signal ?? String(code)})`,
        );
        stop(code === 0 ? 1 : (code ?? 1));
      }
    }
    if (remaining === 0) finish();
  });
}

process.once("SIGINT", () => stop(0, "SIGINT"));
process.once("SIGTERM", () => stop(0));

await finished;
