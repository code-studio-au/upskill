import { spawn } from "node:child_process";
import path from "node:path";

const origins = [
  new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:3000"),
  new URL(process.env.LEARNING_ORIGIN ?? "http://127.0.0.1:3001"),
  ...(process.env.APP_ENV === "test" &&
  process.env.OFFLINE_SCORM_PROTOTYPE_ORIGIN
    ? [new URL(process.env.OFFLINE_SCORM_PROTOTYPE_ORIGIN)]
    : []),
];
for (const [index, origin] of origins.entries()) {
  const allowedHosts =
    index === 2 ? new Set(["127.0.0.2"]) : new Set(["127.0.0.1", "localhost"]);
  if (!allowedHosts.has(origin.hostname) || !origin.port)
    throw new Error(
      "start:origins requires explicit loopback origin hosts and ports",
    );
}
if (new Set(origins.map((origin) => origin.origin)).size !== origins.length)
  throw new Error("Configured local origins must be distinct");

const serverScript = path.resolve("scripts/start-server.mjs");
const services = origins.map((origin) =>
  spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      PORT: origin.port,
      UPSKILL_LISTEN_HOST: origin.hostname,
    },
    stdio: "inherit",
  }),
);

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
    if (service.exitCode === null) service.kill(signal);
}

for (const service of services) {
  service.once("error", () => stop(1));
  service.once("close", (code, signal) => {
    remaining -= 1;
    if (!stopping) stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1);
    if (code && code !== 0) process.exitCode = code;
    if (remaining === 0) finish();
  });
}

process.once("SIGINT", () => stop(0, "SIGINT"));
process.once("SIGTERM", () => stop(0));

await finished;
