import http from "node:http";
import { randomBytes } from "node:crypto";
import { getOfflineScormPrototypeAsset } from "./offline-scorm-package-prototype-assets.mjs";

const applicationOrigin = new URL(
  process.env.OFFLINE_SCORM_PROTOTYPE_APP_ORIGIN ?? "http://127.0.0.1:3300",
);
const learningOrigin = new URL(
  process.env.OFFLINE_SCORM_PROTOTYPE_LEARNING_ORIGIN ??
    "http://127.0.0.1:3301",
);
const packageOrigin = new URL(
  process.env.OFFLINE_SCORM_PROTOTYPE_ORIGIN ?? "http://127.0.0.2:3302",
);
const origins = [applicationOrigin, learningOrigin, packageOrigin];
for (const [index, origin] of origins.entries()) {
  const expectedHost = index === 2 ? "127.0.0.2" : "127.0.0.1";
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

const configuration = {
  applicationOrigin: applicationOrigin.origin,
  cleanupCapability: randomBytes(32).toString("hex"),
  environment: "test",
  learningOrigin: learningOrigin.origin,
  packageOrigin: packageOrigin.origin,
};

function createServer(origin) {
  return http.createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      });
      response.end('{"status":"ready"}');
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
}

const servers = origins.map((origin) => {
  const server = createServer(origin.origin);
  server.listen(Number(origin.port), origin.hostname);
  return server;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  let remaining = servers.length;
  for (const server of servers)
    server.close(() => {
      remaining -= 1;
      if (remaining === 0) process.exit(0);
    });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
