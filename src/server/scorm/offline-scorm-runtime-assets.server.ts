import "@tanstack/react-start/server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildLearningContentSecurityPolicy } from "#/features/scorm/learning-content-security-policy";
import { getServerEnv, type ServerEnv } from "#/server/env.server";

const LEARNING_RUNTIME_PREFIX = "/api/scorm/offline-runtime/";
const runtimeAssetNames = new Set([
  "application-offline.css",
  "application-offline.js",
  "learning-runtime.js",
  "learning-worker.js",
  "package-runtime.js",
  "package-worker.js",
  "shared.js",
]);

export async function readOfflineScormRuntimeAsset(
  assetName: string,
): Promise<string> {
  if (!runtimeAssetNames.has(assetName))
    throw new Error("Unknown offline SCORM runtime asset");
  return await readFile(
    path.resolve(process.cwd(), "dist", "offline-scorm", assetName),
    "utf8",
  );
}

function runtimeHeaders(environment: ServerEnv, contentType: string): Headers {
  return new Headers({
    "Cache-Control": "no-cache",
    "Content-Security-Policy": buildLearningContentSecurityPolicy(
      new URL(environment.APP_ORIGIN).origin,
      {
        connectSources: environment.OFFLINE_SCORM_PACKAGE_HOST_SUFFIX
          ? [`https://*.${environment.OFFLINE_SCORM_PACKAGE_HOST_SUFFIX}`]
          : [],
      },
    ),
    "Content-Type": contentType,
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), display-capture=(), geolocation=(), microphone=(), payment=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
}

function learningFrameHtml(): string {
  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Trusted offline learning runtime</title>
    <script type="module" src="${LEARNING_RUNTIME_PREFIX}learning-runtime.js"></script>
  </head>
  <body><p role="status">Preparing offline learning…</p></body>
</html>`;
}

export async function handleOfflineScormLearningRuntimeRequest(
  request: Request,
): Promise<Response | null> {
  const environment = getServerEnv();
  const url = new URL(request.url);
  if (
    url.origin !== new URL(environment.LEARNING_ORIGIN).origin ||
    !url.pathname.startsWith(LEARNING_RUNTIME_PREFIX)
  )
    return null;
  const headers = runtimeHeaders(environment, "text/plain; charset=utf-8");
  if (request.method !== "GET" && request.method !== "HEAD") {
    headers.set("Allow", "GET, HEAD");
    return new Response(null, { status: 405, headers });
  }
  const assetName = url.pathname.slice(LEARNING_RUNTIME_PREFIX.length);
  if (assetName === "frame.html") {
    const body = learningFrameHtml();
    headers.set("Content-Type", "text/html; charset=utf-8");
    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers,
    });
  }
  if (
    assetName !== "learning-runtime.js" &&
    assetName !== "learning-worker.js" &&
    assetName !== "shared.js"
  )
    return new Response(null, { status: 404, headers });
  const body = await readOfflineScormRuntimeAsset(assetName);
  headers.set("Content-Type", "text/javascript; charset=utf-8");
  if (assetName === "learning-worker.js")
    headers.set("Service-Worker-Allowed", LEARNING_RUNTIME_PREFIX);
  headers.set("Content-Length", String(Buffer.byteLength(body)));
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers,
  });
}

export function offlineScormPackageHostHtml(learningOrigin: string): string {
  return `<!doctype html>
<html lang="en-AU" data-learning-origin="${new URL(learningOrigin).origin}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Offline course module</title>
    <script type="module" src="/.__upskill_offline__/package-runtime.js"></script>
    <style>
      html, body, iframe { border: 0; height: 100%; margin: 0; width: 100%; }
      body { background: #fff; overflow: hidden; }
      #scorm-status { box-sizing: border-box; font: 600 1rem system-ui; padding: 1rem; }
    </style>
  </head>
  <body>
    <p id="scorm-status" role="status">Preparing offline module…</p>
    <iframe id="scorm-content" title="Course module" sandbox="allow-downloads allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"></iframe>
  </body>
</html>`;
}
