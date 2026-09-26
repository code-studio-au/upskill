import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { constants, createGzip } from "node:zlib";
import { Pool } from "pg";
import application from "../dist/server/server.js";
import {
  appendVary,
  isCompressibleContentType,
  selectContentEncoding,
} from "./http-compression.mjs";
import { getOfflineScormPrototypeAsset } from "./offline-scorm-package-prototype-assets.mjs";
import { getPwaShellScriptAsset } from "./pwa-shell-assets.mjs";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const listenHost = process.env.UPSKILL_LISTEN_HOST?.trim() || "127.0.0.1";
const applicationOrigin = new URL(
  process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`,
).origin;
const learningOrigin = new URL(
  process.env.LEARNING_ORIGIN ?? "http://127.0.0.1:3001",
).origin;
const offlineScormPrototypeOrigin =
  process.env.APP_ENV === "test" && process.env.OFFLINE_SCORM_PROTOTYPE_ORIGIN
    ? new URL(process.env.OFFLINE_SCORM_PROTOTYPE_ORIGIN).origin
    : null;
const offlineScormPackageHostSuffix =
  process.env.OFFLINE_SCORM_PACKAGE_HOST_SUFFIX?.trim();
if (
  offlineScormPackageHostSuffix &&
  (offlineScormPackageHostSuffix !==
    offlineScormPackageHostSuffix.toLowerCase() ||
    !/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      offlineScormPackageHostSuffix,
    ))
)
  throw new Error(
    "OFFLINE_SCORM_PACKAGE_HOST_SUFFIX must be canonical lowercase DNS",
  );
const offlineScormPrototypeCleanupCapability =
  process.env.OFFLINE_SCORM_PROTOTYPE_CLEANUP_CAPABILITY?.trim();
if (
  offlineScormPrototypeOrigin &&
  !/^[a-f0-9]{64}$/u.test(offlineScormPrototypeCleanupCapability ?? "")
)
  throw new Error(
    "OFFLINE_SCORM_PROTOTYPE_CLEANUP_CAPABILITY must contain 256 bits",
  );
const allowedOrigins = [
  applicationOrigin,
  learningOrigin,
  ...(offlineScormPrototypeOrigin ? [offlineScormPrototypeOrigin] : []),
];
const tlsCertificateFile = process.env.UPSKILL_TLS_CERT_FILE?.trim();
const tlsKeyFile = process.env.UPSKILL_TLS_KEY_FILE?.trim();
const trustProxySetting = process.env.UPSKILL_TRUST_PROXY?.trim().toLowerCase();
if (
  trustProxySetting !== undefined &&
  trustProxySetting !== "true" &&
  trustProxySetting !== "false"
)
  throw new Error("UPSKILL_TRUST_PROXY must be true or false when configured");
const trustProxy = trustProxySetting === "true";
const readinessPool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  : null;
if (Boolean(tlsCertificateFile) !== Boolean(tlsKeyFile))
  throw new Error(
    "UPSKILL_TLS_CERT_FILE and UPSKILL_TLS_KEY_FILE must be configured together",
  );
const clientDirectory = path.resolve(
  fileURLToPath(new URL("../dist/client/", import.meta.url)),
);
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);
const publicAssetPaths = new Set([
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/apple-touch-icon.png",
  "/brand/home-arrow-background.jpg",
  "/brand/home-icons.svg",
  "/brand/upskill-footer-logo.png",
  "/brand/upskill-icon-navy.png",
  "/brand/upskill-wordmark-navy.png",
  "/favicon.ico",
  "/icons/close-navy.svg",
  "/icons/menu-navy.svg",
  "/offline.css",
  "/offline.html",
  "/site.webmanifest",
]);
const applicationOnlyAssetPaths = new Set(["/offline.css", "/offline.html"]);

const logLevelPriority = { info: 10, warn: 20, error: 30 };

function configuredLogLevel() {
  const configured = process.env.UPSKILL_LOG_LEVEL?.trim().toLowerCase();
  return configured === "off" || Object.hasOwn(logLevelPriority, configured)
    ? configured
    : "info";
}

function classifyThrownValue(error) {
  try {
    if (error instanceof TypeError) return "TypeError";
    if (error instanceof RangeError) return "RangeError";
    if (error instanceof SyntaxError) return "SyntaxError";
    if (error instanceof Error) return "Error";
  } catch {
    return "UnknownThrownValue";
  }
  if (error === null) return "NullThrownValue";
  if (error === undefined) return "UndefinedThrownValue";
  return "NonErrorThrownValue";
}

function logBootstrapEvent(level, type, fields = {}, error) {
  const configured = configuredLogLevel();
  if (
    configured === "off" ||
    logLevelPriority[level] < logLevelPriority[configured]
  )
    return;
  const entry = {
    timestamp: new Date().toISOString(),
    service: "upskill",
    environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
    level,
    type,
    category: "operational",
    ...fields,
    ...(error === undefined ? {} : { errorType: classifyThrownValue(error) }),
  };
  try {
    console[level](JSON.stringify(entry));
  } catch {
    // Bootstrap logging must not change request handling.
  }
}

if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be a valid TCP port");
if (!/^127(?:\.\d{1,3}){3}$/u.test(listenHost) && listenHost !== "localhost")
  throw new Error("UPSKILL_LISTEN_HOST must be an explicit loopback host");

function requestOrigin(incoming) {
  const host = incoming.headers.host?.trim().toLowerCase();
  if (!host) return applicationOrigin;
  const configuredOrigin = allowedOrigins.find((allowedOrigin) => {
    try {
      return new URL(allowedOrigin).host.toLowerCase() === host;
    } catch {
      return false;
    }
  });
  if (configuredOrigin) return configuredOrigin;
  if (offlineScormPackageHostSuffix) {
    try {
      const candidate = new URL(`https://${host}`);
      const hostname = candidate.hostname.endsWith(".")
        ? candidate.hostname.slice(0, -1)
        : candidate.hostname;
      if (
        !candidate.port &&
        hostname.endsWith(`.${offlineScormPackageHostSuffix}`)
      )
        return `https://${hostname}`;
    } catch {
      // Unknown or malformed Host headers fall back to the application origin.
    }
  }
  return applicationOrigin;
}

function isOfflineScormPackageOrigin(origin) {
  if (!offlineScormPackageHostSuffix) return false;
  try {
    const candidate = new URL(origin);
    if (allowedOrigins.includes(candidate.origin)) return false;
    const hostname = candidate.hostname.endsWith(".")
      ? candidate.hostname.slice(0, -1)
      : candidate.hostname;
    return hostname.endsWith(`.${offlineScormPackageHostSuffix}`);
  } catch {
    return false;
  }
}

function servePwaShellScript(incoming, outgoing) {
  const method = incoming.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return false;

  let asset;
  try {
    if (isOfflineScormPackageOrigin(requestOrigin(incoming))) return false;
    asset = getPwaShellScriptAsset(
      new URL(incoming.url ?? "/", requestOrigin(incoming)),
      applicationOrigin,
    );
  } catch {
    return false;
  }
  if (!asset) return false;

  outgoing.statusCode = asset.status;
  for (const [name, value] of Object.entries(asset.headers))
    outgoing.setHeader(name, value);
  outgoing.setHeader("content-length", Buffer.byteLength(asset.body));
  outgoing.end(method === "HEAD" ? undefined : asset.body);
  return true;
}

function serveOfflineScormPrototypeAsset(incoming, outgoing) {
  if (!offlineScormPrototypeOrigin) return false;
  const method = incoming.method ?? "GET";
  if (method !== "GET" && method !== "HEAD" && method !== "POST") return false;

  let asset;
  try {
    asset = getOfflineScormPrototypeAsset(
      new URL(incoming.url ?? "/", requestOrigin(incoming)),
      {
        applicationOrigin,
        cleanupCapability: offlineScormPrototypeCleanupCapability,
        environment: process.env.APP_ENV,
        learningOrigin,
        packageOrigin: offlineScormPrototypeOrigin,
      },
      method,
    );
  } catch {
    return false;
  }
  if (!asset) return false;

  outgoing.statusCode = asset.status;
  for (const [name, value] of Object.entries(asset.headers))
    outgoing.setHeader(name, value);
  outgoing.setHeader("content-length", Buffer.byteLength(asset.body));
  outgoing.end(method === "HEAD" ? undefined : asset.body);
  return true;
}

async function serveClientAsset(incoming, outgoing) {
  const method = incoming.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return false;

  let pathname;
  let origin;
  try {
    origin = requestOrigin(incoming);
    if (isOfflineScormPackageOrigin(origin)) return false;
    pathname = decodeURIComponent(
      new URL(incoming.url ?? "/", origin).pathname,
    );
  } catch {
    return false;
  }
  const isFingerprintedAsset = pathname.startsWith("/assets/");
  const isPublicAsset = publicAssetPaths.has(pathname);
  if (!isFingerprintedAsset && !isPublicAsset) return false;
  if (applicationOnlyAssetPaths.has(pathname) && origin !== applicationOrigin)
    return false;

  const target = path.resolve(clientDirectory, `.${pathname}`);
  if (!target.startsWith(`${clientDirectory}${path.sep}`)) return false;

  let details;
  try {
    details = await stat(target);
  } catch {
    return false;
  }
  if (!details.isFile()) return false;

  let brotliDetails = null;
  let gzipDetails = null;
  try {
    const candidate = await stat(`${target}.br`);
    if (candidate.isFile()) brotliDetails = candidate;
  } catch {
    // This representation was not generated because it was not smaller.
  }
  try {
    const candidate = await stat(`${target}.gz`);
    if (candidate.isFile()) gzipDetails = candidate;
  } catch {
    // This representation was not generated because it was not smaller.
  }
  const encoding = selectContentEncoding(incoming.headers["accept-encoding"], {
    brotliAvailable: Boolean(brotliDetails),
    gzipAvailable: Boolean(gzipDetails),
    secure: incoming.socket.encrypted === true,
  });
  const representation =
    encoding === "br"
      ? { details: brotliDetails, target: `${target}.br` }
      : encoding === "gzip"
        ? { details: gzipDetails, target: `${target}.gz` }
        : { details, target };
  if (!representation.details) return false;

  outgoing.statusCode = 200;
  outgoing.setHeader(
    "cache-control",
    isFingerprintedAsset
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600",
  );
  outgoing.setHeader("content-length", representation.details.size);
  outgoing.setHeader(
    "content-type",
    contentTypes.get(path.extname(target)) ?? "application/octet-stream",
  );
  if (brotliDetails || gzipDetails)
    outgoing.setHeader("vary", "Accept-Encoding");
  if (encoding) outgoing.setHeader("content-encoding", encoding);
  outgoing.setHeader("x-content-type-options", "nosniff");
  if (method === "HEAD") {
    outgoing.end();
  } else {
    createReadStream(representation.target).pipe(outgoing);
  }
  return true;
}

function shouldGzipDynamicResponse(incoming, response) {
  if ((incoming.method ?? "GET") === "HEAD" || !response.body) return false;
  if (
    response.status < 200 ||
    response.status === 204 ||
    response.status === 206 ||
    response.status === 304
  )
    return false;
  if (incoming.headers.range) return false;
  if (response.headers.has("content-encoding")) return false;
  if (response.headers.get("cache-control")?.includes("no-transform"))
    return false;
  if (!isCompressibleContentType(response.headers.get("content-type")))
    return false;
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength < 1024) return false;
  }
  return (
    selectContentEncoding(incoming.headers["accept-encoding"], {
      gzipAvailable: true,
    }) === "gzip"
  );
}

async function handleRequest(incoming, outgoing) {
  const startedAt = performance.now();
  const requestId = randomUUID();
  const method = incoming.method ?? "GET";
  let requestPath = "/invalid-request-target";
  try {
    requestPath = new URL(incoming.url ?? "/", requestOrigin(incoming))
      .pathname;
  } catch {
    // The application will produce the bounded error response below.
  }
  outgoing.setHeader("x-request-id", requestId);
  outgoing.once("finish", () => {
    if (!requestPath.startsWith("/assets/"))
      logBootstrapEvent("info", "http.request_completed", {
        requestId,
        method,
        path: requestPath.slice(0, 512),
        status: outgoing.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
  });
  try {
    if (
      requestPath === "/api/ready" &&
      requestOrigin(incoming) === applicationOrigin &&
      (method === "GET" || method === "HEAD")
    ) {
      outgoing.setHeader("cache-control", "no-store");
      outgoing.setHeader("content-type", "application/json");
      const requestedDeployment = new URL(
        incoming.url ?? "/api/ready",
        requestOrigin(incoming),
      ).searchParams.get("deploymentId");
      const deploymentId = process.env.DEPLOYMENT_ID ?? "development";
      let ready = !requestedDeployment || requestedDeployment === deploymentId;
      if (ready && readinessPool) {
        try {
          await readinessPool.query("select 1");
        } catch {
          ready = false;
        }
      } else {
        ready = false;
      }
      outgoing.statusCode = ready ? 200 : 503;
      outgoing.end(
        method === "HEAD"
          ? undefined
          : JSON.stringify({
              status: ready ? "ready" : "not_ready",
              service: "upskill",
              deploymentId,
            }),
      );
      return;
    }
    if (servePwaShellScript(incoming, outgoing)) return;
    if (serveOfflineScormPrototypeAsset(incoming, outgoing)) return;
    if (await serveClientAsset(incoming, outgoing)) return;

    const headers = new Headers();
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
      const name = incoming.rawHeaders[index];
      const value = incoming.rawHeaders[index + 1];
      if (name && value) headers.append(name, value);
    }
    const remoteAddress = incoming.socket.remoteAddress;
    if (!trustProxy || !headers.has("x-real-ip")) {
      if (remoteAddress) headers.set("x-real-ip", remoteAddress);
      else headers.delete("x-real-ip");
    }

    headers.set("x-request-id", requestId);
    const requestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(120_000),
    };
    if (method !== "GET" && method !== "HEAD") {
      requestInit.body = Readable.toWeb(incoming);
      requestInit.duplex = "half";
    }

    const request = new Request(
      new URL(incoming.url ?? "/", requestOrigin(incoming)),
      requestInit,
    );
    const response = await application.fetch(request);
    const gzipResponse = shouldGzipDynamicResponse(incoming, response);
    for (const [name, value] of response.headers) {
      const normalizedName = name.toLowerCase();
      if (
        normalizedName !== "set-cookie" &&
        !(gzipResponse && normalizedName === "content-length")
      )
        outgoing.setHeader(name, value);
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) outgoing.setHeader("set-cookie", cookies);
    outgoing.statusCode = response.status;

    if (!response.body) {
      outgoing.end();
      return;
    }
    if (gzipResponse) {
      outgoing.setHeader("content-encoding", "gzip");
      outgoing.setHeader(
        "vary",
        appendVary(outgoing.getHeader("vary"), "Accept-Encoding"),
      );
      await pipeline(
        Readable.fromWeb(response.body),
        createGzip({ level: 6, flush: constants.Z_SYNC_FLUSH }),
        outgoing,
      );
      return;
    }
    await pipeline(Readable.fromWeb(response.body), outgoing);
  } catch (error) {
    logBootstrapEvent(
      "error",
      "http.request_failed",
      { requestId, method, path: requestPath.slice(0, 512) },
      error,
    );
    if (!outgoing.headersSent) {
      outgoing.statusCode = 500;
      outgoing.setHeader("content-type", "application/json");
      outgoing.end(JSON.stringify({ error: "internal_server_error" }));
    } else {
      outgoing.destroy(error instanceof Error ? error : undefined);
    }
  }
}

const server = tlsCertificateFile
  ? https.createServer(
      {
        cert: readFileSync(tlsCertificateFile),
        key: readFileSync(tlsKeyFile),
      },
      handleRequest,
    )
  : http.createServer(handleRequest);

server.listen(port, listenHost, () => {
  logBootstrapEvent("info", "server.started", {
    status: "ready",
    port,
    protocol: tlsCertificateFile ? "https" : "http",
    deploymentId: process.env.DEPLOYMENT_ID?.slice(0, 512),
  });
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      void readinessPool?.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
