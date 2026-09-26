export const APPLICATION_SERVICE_WORKER_PATH =
  "/pwa/application-service-worker.js";
export const OFFLINE_COURSES_PAGE_PATH = "/offline-learning.html";
export const OFFLINE_COURSES_SCRIPT_PATH = "/pwa/offline-learning.js";
export const OFFLINE_COURSES_SHARED_PATH = "/pwa/shared.js";
export const OFFLINE_COURSES_STYLE_PATH = "/pwa/offline-learning.css";
export const APPLICATION_SERVICE_WORKER_SOURCE = `const APPLICATION_SHELL_CACHE = "upskill-application-shell-v2";
const APPLICATION_SHELL_CACHE_PREFIX = "upskill-application-shell-";
const OFFLINE_FALLBACK_URL = "/offline.html";
const OFFLINE_COURSES_PAGE_PATH = "/offline-learning.html";
const OFFLINE_COURSES_SCRIPT_PATH = "/pwa/offline-learning.js";
const OFFLINE_COURSES_SHARED_PATH = "/pwa/shared.js";
const OFFLINE_COURSES_STYLE_PATH = "/pwa/offline-learning.css";
const APPLICATION_SHELL_ASSETS = [
  OFFLINE_FALLBACK_URL,
  OFFLINE_COURSES_PAGE_PATH,
  OFFLINE_COURSES_SCRIPT_PATH,
  OFFLINE_COURSES_SHARED_PATH,
  OFFLINE_COURSES_STYLE_PATH,
  "/offline.css",
  "/site.webmanifest",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APPLICATION_SHELL_CACHE)
      .then((cache) => cache.addAll(APPLICATION_SHELL_ASSETS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        const deletions = [];
        for (const cacheName of cacheNames)
          if (
            cacheName.startsWith(APPLICATION_SHELL_CACHE_PREFIX) &&
            cacheName !== APPLICATION_SHELL_CACHE
          )
            deletions.push(caches.delete(cacheName));
        return Promise.all(deletions);
      })
      .then(() => clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (APPLICATION_SHELL_ASSETS.includes(requestUrl.pathname)) {
    event.respondWith(
      caches.match(requestUrl.pathname, {
        cacheName: APPLICATION_SHELL_CACHE,
      }).then((cached) => cached ?? fetch(event.request)),
    );
    return;
  }

  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const fallback = await caches.match(OFFLINE_FALLBACK_URL, {
        cacheName: APPLICATION_SHELL_CACHE,
      });
      return fallback ?? Response.error();
    }),
  );
});
`;

export const REGISTRATION_SCRIPT_PATH = "/pwa/register.js";
export const MOBILE_PWA_MEDIA_QUERY = "(hover: none) and (pointer: coarse)";
export const REGISTRATION_SCRIPT_SOURCE = `if (
  "serviceWorker" in navigator &&
  window.matchMedia("${MOBILE_PWA_MEDIA_QUERY}").matches
)
  window.addEventListener(
    "load",
    () => {
      void navigator.serviceWorker
        .register("${APPLICATION_SERVICE_WORKER_PATH}", {
          scope: "/",
          updateViaCache: "none",
        })
        .catch(() => undefined);
    },
    { once: true },
  );
`;

function offlineCoursesPage(
  applicationOrigin,
  learningOrigin,
  packageHostSuffix,
) {
  const applicationUrl = new URL(applicationOrigin);
  const packageFrameSource =
    packageHostSuffix === "localhost" &&
    applicationUrl.protocol === "http:" &&
    applicationUrl.hostname.endsWith(".localhost")
      ? `http://*.localhost${applicationUrl.port ? `:${applicationUrl.port}` : ""}`
      : packageHostSuffix
        ? `https://*.${packageHostSuffix}`
        : undefined;
  const frameSources = [
    new URL(learningOrigin).origin,
    ...(packageFrameSource ? [packageFrameSource] : []),
  ].join(" ");
  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#081d40">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'self'; form-action 'none'; frame-src ${frameSources}; img-src 'self'; manifest-src 'self'; script-src 'self'; style-src 'self'">
    <title>Offline courses — Upskill</title>
    <link rel="manifest" href="/site.webmanifest" media="(hover: none) and (pointer: coarse)">
    <link rel="stylesheet" href="${OFFLINE_COURSES_STYLE_PATH}">
    <script type="module" src="${OFFLINE_COURSES_SCRIPT_PATH}"></script>
  </head>
  <body>
    <main>
      <img src="/android-chrome-192x192.png" alt="" width="72" height="72">
      <p class="eyebrow">Upskill Institute</p>
      <h1>Offline courses</h1>
      <p id="offline-status" role="status">Checking this device…</p>
      <section id="offline-download" hidden>
        <strong id="offline-download-title"></strong>
        <button id="offline-download-button" type="button">Prepare offline</button>
      </section>
      <div id="offline-courses"></div>
      <a class="action" href="/">Reconnect to Upskill</a>
    </main>
    <div id="offline-player" hidden>
      <div class="toolbar"><strong id="offline-player-title"></strong><button id="offline-player-close" type="button">Close</button></div>
      <iframe id="offline-learning-frame" title="Trusted offline learning runtime"></iframe>
      <iframe id="offline-package-frame" title="Offline course module" sandbox="allow-downloads allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"></iframe>
    </div>
  </body>
</html>`;
}

const scriptSources = new Map([
  [APPLICATION_SERVICE_WORKER_PATH, APPLICATION_SERVICE_WORKER_SOURCE],
  [REGISTRATION_SCRIPT_PATH, REGISTRATION_SCRIPT_SOURCE],
]);

export function getPwaShellScriptAsset(
  requestUrl,
  applicationOrigin,
  options = {},
) {
  const source =
    requestUrl.pathname === OFFLINE_COURSES_PAGE_PATH && options.learningOrigin
      ? offlineCoursesPage(
          applicationOrigin,
          options.learningOrigin,
          options.packageHostSuffix,
        )
      : requestUrl.pathname === OFFLINE_COURSES_SCRIPT_PATH
        ? options.offlineCoursesScript
        : requestUrl.pathname === OFFLINE_COURSES_SHARED_PATH
          ? options.offlineCoursesShared
          : requestUrl.pathname === OFFLINE_COURSES_STYLE_PATH
            ? options.offlineCoursesStyle
            : scriptSources.get(requestUrl.pathname);
  if (source === undefined) return null;
  if (requestUrl.origin !== new URL(applicationOrigin).origin)
    return {
      body: "",
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
      status: 404,
    };

  return {
    body: source,
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": requestUrl.pathname.endsWith(".html")
        ? "text/html; charset=utf-8"
        : requestUrl.pathname.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "text/javascript; charset=utf-8",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      ...(requestUrl.pathname === APPLICATION_SERVICE_WORKER_PATH
        ? { "Service-Worker-Allowed": "/" }
        : {}),
      "X-Content-Type-Options": "nosniff",
    },
    status: 200,
  };
}
