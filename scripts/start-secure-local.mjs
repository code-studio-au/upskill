import { spawn } from "node:child_process";
import path from "node:path";
import { ensureLocalTls } from "./local-tls.mjs";

const applicationPort = process.env.UPSKILL_HTTPS_PORT ?? "3443";
const learningPort = process.env.UPSKILL_LEARNING_HTTPS_PORT ?? "3444";
for (const [name, port] of [
  ["UPSKILL_HTTPS_PORT", applicationPort],
  ["UPSKILL_LEARNING_HTTPS_PORT", learningPort],
])
  if (!/^\d{2,5}$/u.test(port) || Number(port) > 65_535)
    throw new Error(`${name} must be a valid TCP port`);
if (applicationPort === learningPort)
  throw new Error("Secure application and learning ports must be distinct");

const tls = await ensureLocalTls();
const applicationOrigin = `https://localhost:${applicationPort}`;
const learningOrigin = `https://localhost:${learningPort}`;
const child = spawn(
  process.execPath,
  [path.resolve("scripts/start-local-origins.mjs")],
  {
    env: {
      ...process.env,
      APP_ORIGIN: applicationOrigin,
      LEARNING_ORIGIN: learningOrigin,
      NODE_EXTRA_CA_CERTS: tls.caCertificate,
      UPSKILL_TLS_CERT_FILE: tls.certificate,
      UPSKILL_TLS_KEY_FILE: tls.key,
    },
    stdio: "inherit",
  },
);

console.log(`Upskill secure local application: ${applicationOrigin}`);
console.log(`Upskill secure local learning origin: ${learningOrigin}`);
console.log(`Local development CA: ${tls.caCertificate}`);
console.log(
  "Trust that CA in your development browser or operating-system keychain once to remove certificate warnings.",
);

child.once("error", (error) => {
  console.error(`Unable to start secure local Upskill: ${error.message}`);
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
