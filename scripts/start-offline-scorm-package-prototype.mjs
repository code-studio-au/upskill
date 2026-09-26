import http from "node:http";
import { randomBytes } from "node:crypto";
import { getOfflineScormPrototypeAsset } from "./offline-scorm-package-prototype-assets.mjs";

const applicationOrigin = new URL(
  process.env.OFFLINE_SCORM_PROTOTYPE_APP_ORIGIN ?? "http://app.localhost:3300",
);
const learningOrigin = new URL(
  process.env.OFFLINE_SCORM_PROTOTYPE_LEARNING_ORIGIN ??
    "http://learn.localhost:3300",
);
const packageOrigin = new URL(
  process.env.OFFLINE_SCORM_PROTOTYPE_ORIGIN ??
    "http://p-prototype.localhost:3300",
);
const origins = [applicationOrigin, learningOrigin, packageOrigin];
for (const [index, origin] of origins.entries()) {
  const expectedHost = [
    "app.localhost",
    "learn.localhost",
    "p-prototype.localhost",
  ][index];
  if (
    origin.protocol !== "http:" ||
    origin.hostname !== expectedHost ||
    !origin.port ||
    origin.pathname !== "/"
  )
    throw new Error("Prototype origins must use their explicit loopback hosts");
}
if (new Set(origins.map((origin) => origin.origin)).size !== origins.length)
  throw new Error("Prototype origins must be distinct");
if (new Set(origins.map((origin) => origin.port)).size !== 1)
  throw new Error("Prototype localhost origins must share one port");

const configuration = {
  applicationOrigin: applicationOrigin.origin,
  cleanupCapability: randomBytes(32).toString("hex"),
  environment: "test",
  learningOrigin: learningOrigin.origin,
  packageOrigin: packageOrigin.origin,
};

const configuredOrigins = new Map(
  origins.map((origin) => [origin.host.toLowerCase(), origin.origin]),
);
const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    });
    response.end('{"status":"ready"}');
    return;
  }
  const origin = configuredOrigins.get(
    request.headers.host?.trim().toLowerCase() ?? "",
  );
  if (!origin) {
    response.writeHead(404, { "Cache-Control": "no-store" });
    response.end();
    return;
  }
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.method !== "POST"
  ) {
    response.writeHead(405, { Allow: "GET, HEAD, POST" });
    response.end();
    return;
  }
  const asset = getOfflineScormPrototypeAsset(
    new URL(request.url ?? "/", origin),
    configuration,
    request.method,
  );
  if (!asset) {
    response.writeHead(404, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
    return;
  }
  response.writeHead(asset.status, {
    ...asset.headers,
    "Content-Length": Buffer.byteLength(asset.body),
  });
  response.end(request.method === "HEAD" ? undefined : asset.body);
});
server.listen(Number(applicationOrigin.port), "127.0.0.1");

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
