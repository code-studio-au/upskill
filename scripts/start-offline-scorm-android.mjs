import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { loadOrCreateOfflineScormAndroidRuntime } from "./offline-scorm-android-runtime.mjs";

const execFileAsync = promisify(execFile);
const port = process.env.UPSKILL_ANDROID_PORT?.trim() || "8080";
if (!/^\d{2,5}$/u.test(port) || Number(port) > 65_535)
  throw new Error("UPSKILL_ANDROID_PORT must be a valid user-space port");

const adb = process.env.UPSKILL_ADB_PATH?.trim() || "adb";
// Android WebAPKs preserve the HTTP scheme only for the exact localhost
// hostname. A subdomain such as app.localhost is installable, but Chrome
// rewrites its packaged scope to HTTPS and opens its HTTP start URL in a tab.
const applicationOrigin = `http://localhost:${port}`;
const learningOrigin = `http://learn.localhost:${port}`;
const runtime = await loadOrCreateOfflineScormAndroidRuntime();

async function adbCommand(arguments_) {
  try {
    return await execFileAsync(adb, ["-d", ...arguments_], {
      encoding: "utf8",
    });
  } catch (error) {
    throw new Error(
      `ADB command failed (${arguments_.join(" ")}). Connect one unlocked Android device with USB debugging enabled.`,
      { cause: error },
    );
  }
}

await adbCommand(["get-state"]);
await adbCommand(["reverse", `tcp:${port}`, `tcp:${port}`]);

const server = spawn(process.execPath, ["scripts/start-local-origins.mjs"], {
  env: {
    ...process.env,
    APP_ENV: "development",
    APP_ORIGIN: applicationOrigin,
    LEARNING_ORIGIN: learningOrigin,
    LIVEKIT_ENABLED: "false",
    LIVEKIT_PROJECT_ENVIRONMENT: "development",
    OFFLINE_SCORM_ENABLED: "true",
    OFFLINE_SCORM_ENTITLEMENT_SIGNING_KEY_ID: "offline-scorm-android-local-v1",
    OFFLINE_SCORM_ENTITLEMENT_SIGNING_PRIVATE_KEY_PKCS8:
      runtime.signingPrivateKeyPkcs8,
    OFFLINE_SCORM_PACKAGE_HOST_SUFFIX: "localhost",
    OFFLINE_SCORM_PACKAGE_SITE_SUFFIX: "localhost",
    OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY: runtime.packageSiteOriginKey,
    OFFLINE_SCORM_PROTOTYPE_ORIGIN: undefined,
    PORT: port,
  },
  stdio: "inherit",
});
const serverClosed = new Promise((resolve) => server.once("close", resolve));

let stopping = false;
let exitCode = 0;
async function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  if (server.exitCode === null) server.kill(signal);
  try {
    await adbCommand(["reverse", "--remove", `tcp:${port}`]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    exitCode ||= 1;
  }
}

for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    exitCode = signal === "SIGINT" ? 130 : 143;
    void stop(signal);
  });

server.once("error", (error) => {
  console.error(error);
  exitCode = 1;
  void stop();
});
server.once("close", (code, signal) => {
  if (stopping) return;
  console.error(
    `The local Upskill server stopped ${signal ? `with ${signal}` : `with code ${String(code)}`}.`,
  );
  exitCode = code || 1;
  void stop();
});

const readinessDeadline = Date.now() + 120_000;
let ready = false;
while (!ready && !stopping && Date.now() < readinessDeadline) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ready`, {
      cache: "no-store",
    });
    ready = response.ok;
  } catch {
    // The server may still be starting.
  }
  if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
}

if (!ready && !stopping) {
  console.error(
    "The local Upskill server did not become ready within 120 seconds.",
  );
  exitCode = 1;
  await stop();
} else if (ready) {
  try {
    await adbCommand([
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      applicationOrigin,
      "com.android.chrome",
    ]);
    console.log(`Opened ${applicationOrigin} in Android Chrome.`);
    console.log(
      "Press Ctrl-C to stop the server and remove the ADB reverse rule.",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    exitCode = 1;
    await stop();
  }
}

await serverClosed;
await stop();
process.exitCode = exitCode || server.exitCode || 0;
