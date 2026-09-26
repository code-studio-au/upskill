const CACHE_NAME = "upskill-offline-scorm-learning-runtime-v1";
const CACHE_PREFIX = "upskill-offline-scorm-learning-runtime-";
const ASSETS = [
  "/api/scorm/offline-runtime/frame.html",
  "/api/scorm/offline-runtime/learning-runtime.js",
  "/api/scorm/offline-runtime/shared.js",
];

interface WorkerExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerFetchEvent extends WorkerExtendableEvent {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}

const workerSelf = self as unknown as {
  clients: { claim(): Promise<void> };
  location: Location;
};

self.addEventListener("install", (event) => {
  (event as WorkerExtendableEvent).waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)),
  );
});

self.addEventListener("activate", (event) => {
  (event as WorkerExtendableEvent).waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => workerSelf.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const fetchEvent = event as WorkerFetchEvent;
  if (fetchEvent.request.method !== "GET") return;
  const url = new URL(fetchEvent.request.url);
  if (
    url.origin !== workerSelf.location.origin ||
    !ASSETS.includes(url.pathname)
  )
    return;
  fetchEvent.respondWith(
    caches
      .match(fetchEvent.request, { cacheName: CACHE_NAME })
      .then((cached) => cached ?? fetch(fetchEvent.request)),
  );
});
