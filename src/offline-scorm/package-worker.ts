import {
  installOfflineScormPackage,
  matchInstalledOfflineScormPackage,
  offlineScormPackageManifestSchema,
  type OfflineScormPackageManifest,
} from "#/features/scorm/offline-scorm-package-prototype";

const RUNTIME_CACHE = "upskill-offline-scorm-package-runtime-v1";
const MANIFEST_URL = "/.__upskill_offline__/installed-manifest.json";
const RUNTIME_PATHS = [
  "/.__upskill_offline__/host.html",
  "/.__upskill_offline__/package-runtime.js",
  "/.__upskill_offline__/shared.js",
];

interface WorkerExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerMessageEvent extends MessageEvent {
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerFetchEvent extends WorkerExtendableEvent {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}

const workerSelf = self as unknown as {
  clients: { claim(): Promise<void> };
  location: Location;
  skipWaiting(): Promise<void>;
};

async function readManifest(): Promise<
  OfflineScormPackageManifest | undefined
> {
  const response = await caches
    .open(RUNTIME_CACHE)
    .then((cache) => cache.match(MANIFEST_URL));
  if (!response) return undefined;
  const parsed = offlineScormPackageManifestSchema.safeParse(
    await response.json(),
  );
  return parsed.success ? parsed.data : undefined;
}

async function install(manifestValue: unknown): Promise<void> {
  const manifest = offlineScormPackageManifestSchema.parse(manifestValue);
  const workerUrl = new URL(workerSelf.location.href);
  await installOfflineScormPackage({
    manifest,
    applicationOrigin:
      workerUrl.searchParams.get("applicationOrigin") ??
      "https://invalid.invalid",
    learningOrigin:
      workerUrl.searchParams.get("learningOrigin") ?? "https://invalid.invalid",
    caches,
    fetch,
    subtle: crypto.subtle,
    randomUUID: () => crypto.randomUUID(),
  });
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  for (const pathname of RUNTIME_PATHS) {
    const response = await fetch(pathname, {
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) throw new Error("The package runtime is unavailable");
    await runtimeCache.put(pathname, response);
  }
  await runtimeCache.put(
    MANIFEST_URL,
    new Response(JSON.stringify(manifest), {
      headers: { "Content-Type": "application/json" },
    }),
  );
}

self.addEventListener("install", (event) => {
  (event as WorkerExtendableEvent).waitUntil(workerSelf.skipWaiting());
});
self.addEventListener("activate", (event) => {
  (event as WorkerExtendableEvent).waitUntil(workerSelf.clients.claim());
});
self.addEventListener("message", (event) => {
  const messageEvent = event as WorkerMessageEvent;
  const message = messageEvent.data as Record<string, unknown> | undefined;
  if (!message || messageEvent.ports.length !== 1) return;
  const [responsePort] = messageEvent.ports;
  if (!responsePort) return;
  if (message.type === "offline-scorm-install-package")
    messageEvent.waitUntil(
      install(message.manifest).then(
        () => {
          responsePort.postMessage({ status: "ready" });
        },
        () => {
          responsePort.postMessage({ status: "failed" });
        },
      ),
    );
  else if (message.type === "offline-scorm-get-manifest")
    messageEvent.waitUntil(
      readManifest().then((manifest) => {
        responsePort.postMessage(
          manifest ? { status: "ready", manifest } : { status: "missing" },
        );
      }),
    );
});
self.addEventListener("fetch", (event) => {
  const fetchEvent = event as WorkerFetchEvent;
  if (fetchEvent.request.method !== "GET") return;
  const url = new URL(fetchEvent.request.url);
  if (url.origin !== workerSelf.location.origin) return;
  if (RUNTIME_PATHS.includes(url.pathname)) {
    fetchEvent.respondWith(
      caches
        .open(RUNTIME_CACHE)
        .then(
          async (cache) =>
            (await cache.match(fetchEvent.request)) ??
            fetch(fetchEvent.request),
        ),
    );
    return;
  }
  fetchEvent.respondWith(
    readManifest().then(async (manifest) => {
      if (!manifest) return fetch(fetchEvent.request);
      return (
        (await matchInstalledOfflineScormPackage({
          manifest,
          applicationOrigin:
            new URL(workerSelf.location.href).searchParams.get(
              "applicationOrigin",
            ) ?? "https://invalid.invalid",
          caches,
          request: fetchEvent.request,
          subtle: crypto.subtle,
        })) ?? fetch(fetchEvent.request)
      );
    }),
  );
});
