import { spawn } from "node:child_process";
import path from "node:path";

const playwright = path.resolve("node_modules/@playwright/test/cli.js");
const child = spawn(
  process.execPath,
  [
    playwright,
    "test",
    "--project=chromium-mobile",
    "--grep=secure local origin negotiates compression",
  ],
  {
    env: {
      ...process.env,
      PLAYWRIGHT_HTTPS: "true",
      PLAYWRIGHT_PORT: process.env.PLAYWRIGHT_PORT ?? "3643",
      PLAYWRIGHT_LEARNING_PORT: process.env.PLAYWRIGHT_LEARNING_PORT ?? "3644",
    },
    stdio: "inherit",
  },
);

child.once("error", (error) => {
  console.error(`Unable to start secure browser smoke: ${error.message}`);
  process.exitCode = 1;
});
child.once("close", (code, signal) => {
  process.exitCode =
    signal === "SIGINT" || signal === "SIGTERM" ? 0 : (code ?? 1);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    if (child.exitCode === null) child.kill(signal);
  });

await new Promise((resolve) => child.once("close", resolve));
