export const APPLICATION_SERVICE_WORKER_PATH =
  "/pwa/application-service-worker.js";
export const APPLICATION_SERVICE_WORKER_SOURCE = `const APPLICATION_SHELL_CACHE = "upskill-application-shell-v1";
const APPLICATION_SHELL_CACHE_PREFIX = "upskill-application-shell-";
const OFFLINE_FALLBACK_URL = "/offline.html";
const APPLICATION_SHELL_ASSETS = [
  OFFLINE_FALLBACK_URL,
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
  if (event.request.method !== "GET" || event.request.mode !== "navigate")
    return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

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

const scriptSources = new Map([
  [APPLICATION_SERVICE_WORKER_PATH, APPLICATION_SERVICE_WORKER_SOURCE],
  [REGISTRATION_SCRIPT_PATH, REGISTRATION_SCRIPT_SOURCE],
]);

export function getPwaShellScriptAsset(requestUrl, applicationOrigin) {
  const source = scriptSources.get(requestUrl.pathname);
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
      "Content-Type": "text/javascript; charset=utf-8",
      "Cross-Origin-Resource-Policy": "same-origin",
      ...(requestUrl.pathname === APPLICATION_SERVICE_WORKER_PATH
        ? { "Service-Worker-Allowed": "/" }
        : {}),
      "X-Content-Type-Options": "nosniff",
    },
    status: 200,
  };
}
