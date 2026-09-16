import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  APPLICATION_SERVICE_WORKER_PATH,
  APPLICATION_SERVICE_WORKER_SOURCE,
  MOBILE_PWA_MEDIA_QUERY,
  REGISTRATION_SCRIPT_PATH,
  REGISTRATION_SCRIPT_SOURCE,
  getPwaShellScriptAsset,
} from "./pwa-shell-assets.mjs";

const root = path.resolve(import.meta.dirname, "..");

function createWorkerHarness() {
  const listeners = new Map();
  const cache = {
    addAll: vi.fn(async () => undefined),
  };
  const cacheStorage = {
    delete: vi.fn(async () => true),
    keys: vi.fn(async () => []),
    match: vi.fn(async () => undefined),
    open: vi.fn(async () => cache),
  };
  const clients = { claim: vi.fn(async () => undefined) };
  const networkFetch = vi.fn();
  const serviceWorker = {
    addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    location: { origin: "https://app.example.test" },
  };

  vm.runInNewContext(APPLICATION_SERVICE_WORKER_SOURCE, {
    Response,
    URL,
    caches: cacheStorage,
    clients,
    fetch: networkFetch,
    self: serviceWorker,
  });

  return { cache, cacheStorage, clients, listeners, networkFetch };
}

function createRegistrationHarness({ mobile }) {
  const register = vi.fn(async () => undefined);
  const listeners = new Map();
  const matchMedia = vi.fn(() => ({ matches: mobile }));

  vm.runInNewContext(REGISTRATION_SCRIPT_SOURCE, {
    navigator: { serviceWorker: { register } },
    window: {
      addEventListener: vi.fn((type, listener) =>
        listeners.set(type, listener),
      ),
      matchMedia,
    },
  });

  return { listeners, matchMedia, register };
}

describe("application PWA shell", () => {
  it("declares a scoped standalone application manifest", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "public/site.webmanifest"), "utf8"),
    );

    expect(manifest).toMatchObject({
      id: "/",
      lang: "en-AU",
      scope: "/",
      start_url: "/?source=pwa",
      display: "standalone",
      theme_color: "#081D40",
    });
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "any" }),
      ]),
    );

    const offlineDocument = fs.readFileSync(
      path.join(root, "public/offline.html"),
      "utf8",
    );
    expect(offlineDocument).toContain(`media="${MOBILE_PWA_MEDIA_QUERY}"`);
  });

  it("serves scripts only from the configured application origin", () => {
    const worker = getPwaShellScriptAsset(
      new URL(`https://app.example.test${APPLICATION_SERVICE_WORKER_PATH}`),
      "https://app.example.test",
    );
    expect(worker).toMatchObject({
      status: 200,
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "text/javascript; charset=utf-8",
        "Service-Worker-Allowed": "/",
      },
    });
    expect(worker?.body).toBe(APPLICATION_SERVICE_WORKER_SOURCE);

    expect(
      getPwaShellScriptAsset(
        new URL(`https://learn.example.test${REGISTRATION_SCRIPT_PATH}`),
        "https://app.example.test",
      ),
    ).toMatchObject({ status: 404, body: "" });
    expect(
      getPwaShellScriptAsset(
        new URL("https://app.example.test/pwa/not-supported.js"),
        "https://app.example.test",
      ),
    ).toBeNull();
  });

  it("registers the application worker only on a mobile form factor", async () => {
    const mobile = createRegistrationHarness({ mobile: true });
    expect(mobile.matchMedia).toHaveBeenCalledWith(MOBILE_PWA_MEDIA_QUERY);
    expect(mobile.listeners.has("load")).toBe(true);
    mobile.listeners.get("load")();
    await vi.waitFor(() =>
      expect(mobile.register).toHaveBeenCalledWith(
        APPLICATION_SERVICE_WORKER_PATH,
        { scope: "/", updateViaCache: "none" },
      ),
    );

    const desktop = createRegistrationHarness({ mobile: false });
    expect(desktop.listeners.has("load")).toBe(false);
    expect(desktop.register).not.toHaveBeenCalled();
  });

  it("pre-caches only the public fallback shell", async () => {
    const { cache, listeners } = createWorkerHarness();
    let installation;

    listeners.get("install")({
      waitUntil: (promise) => {
        installation = promise;
      },
    });
    await installation;

    expect(cache.addAll).toHaveBeenCalledWith([
      "/offline.html",
      "/offline.css",
      "/site.webmanifest",
      "/favicon.ico",
      "/apple-touch-icon.png",
      "/android-chrome-192x192.png",
      "/android-chrome-512x512.png",
    ]);
  });

  it("uses the static fallback only when a same-origin navigation is offline", async () => {
    const { cacheStorage, listeners, networkFetch } = createWorkerHarness();
    const offlineFallback = new Response("offline", {
      headers: { "Content-Type": "text/html" },
    });
    networkFetch.mockRejectedValue(new TypeError("offline"));
    cacheStorage.match.mockResolvedValue(offlineFallback);
    let response;

    listeners.get("fetch")({
      request: {
        method: "GET",
        mode: "navigate",
        url: "https://app.example.test/dashboard",
      },
      respondWith: (promise) => {
        response = promise;
      },
    });

    await expect(response).resolves.toBe(offlineFallback);
    expect(cacheStorage.match).toHaveBeenCalledWith("/offline.html", {
      cacheName: "upskill-application-shell-v1",
    });
  });

  it("does not intercept API or subresource requests", () => {
    const { listeners, networkFetch } = createWorkerHarness();
    const respondWith = vi.fn();

    listeners.get("fetch")({
      request: {
        method: "GET",
        mode: "cors",
        url: "https://app.example.test/api/scorm/launches",
      },
      respondWith,
    });

    expect(respondWith).not.toHaveBeenCalled();
    expect(networkFetch).not.toHaveBeenCalled();
  });
});
