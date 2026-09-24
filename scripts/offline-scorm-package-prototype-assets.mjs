import { createHash } from "node:crypto";

export const OFFLINE_SCORM_PROTOTYPE_PREFIX =
  "/__offline-scorm-package-prototype";

const paths = {
  applicationHtml: `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/application.html`,
  applicationScript: `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/application.js`,
  learningHtml: `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/learning.html`,
  learningScript: `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/learning.js`,
  packageHtml: `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/package.html`,
  packageScript: `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/package.js`,
  packageWorker: `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/package-worker.js`,
  clearSiteData: `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/clear-site-data`,
  vendorHtml: `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/vendor.html`,
  vendorScript: `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/vendor.js`,
};
const packageFrameSandbox =
  "allow-downloads allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation";

function page(title, scriptPath, body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <script src="${scriptPath}" defer></script>
  </head>
  <body>${body}</body>
</html>`;
}

const vendorScript = `(() => {
  "use strict";
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.origin !== location.origin) return;
    if (event.data?.type !== "prototype-vendor-commit") return;
    const api = parent.API;
    const initialized = window.prototypeInitialized ?? "false";
    const locationSet = api?.LMSSetValue("cmi.core.lesson_location", "slide-2");
    const timeSet = api?.LMSSetValue("cmi.core.session_time", "00:00:20");
    const committed = api?.LMSCommit("");
    parent.postMessage(
      {
        type: "prototype-vendor-result",
        initialized,
        locationSet,
        timeSet,
        committed,
      },
      location.origin,
    );
  });
})();
`;

const vendorHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Rise package fixture</title>
    <style>#vendor-ready { display: block; }</style>
    <script src="${paths.vendorScript}" defer></script>
  </head>
  <body>
    <p id="vendor-ready">Rise fixture blocked</p>
    <script>
      window.prototypeInitialized = parent.API?.LMSInitialize("") ?? "false";
      const readyText = eval("'Rise fixture ready'");
      if (window.prototypeInitialized === "true")
        document.getElementById("vendor-ready").textContent = readyText;
    </script>
  </body>
</html>`;

function applicationScript({
  applicationOrigin,
  learningOrigin,
  packageOrigin,
}) {
  return `(() => {
    "use strict";
    const APPLICATION_ORIGIN = ${JSON.stringify(applicationOrigin)};
    const LEARNING_ORIGIN = ${JSON.stringify(learningOrigin)};
    const PACKAGE_ORIGIN = ${JSON.stringify(packageOrigin)};
    const learningFrame = document.getElementById("learning-frame");
    const packageFrame = document.getElementById("package-frame");
    const events = [];
    let learningReady = false;
    let packageReady = false;

    function record(event) {
      events.push({ ...event, recordedAt: Date.now() });
      document.getElementById("status").textContent = event.type;
    }

    function bind() {
      if (!learningReady || !packageReady) return;
      const channel = new MessageChannel();
      const message = {
        type: "offline-scorm-sibling-channel",
        protocolVersion: 1,
      };
      learningFrame.contentWindow.postMessage(message, LEARNING_ORIGIN, [
        channel.port1,
      ]);
      packageFrame.contentWindow.postMessage(message, PACKAGE_ORIGIN, [
        channel.port2,
      ]);
      record({ type: "prototype-channel-bound" });
    }

    window.addEventListener("message", (event) => {
      if (event.origin === LEARNING_ORIGIN && event.source === learningFrame.contentWindow) {
        if (
          event.data?.type === "offline-scorm-sibling-ready" &&
          event.data.protocolVersion === 1 &&
          event.data.role === "learning"
        ) {
          learningReady = true;
          record({ type: "prototype-learning-ready", cookie: event.data.cookie });
          bind();
          return;
        }
        record(event.data ?? { type: "prototype-invalid-learning-message" });
        return;
      }
      if (event.origin === PACKAGE_ORIGIN && event.source === packageFrame.contentWindow) {
        if (
          event.data?.type === "offline-scorm-sibling-ready" &&
          event.data.protocolVersion === 1 &&
          event.data.role === "package"
        ) {
          packageReady = true;
          record({
            type: "prototype-package-ready",
            cookie: event.data.cookie,
            cacheReady: event.data.cacheReady,
          });
          bind();
          return;
        }
        record(event.data ?? { type: "prototype-invalid-package-message" });
      }
    });

    document.cookie = "application_session=application-only; SameSite=Strict";
    learningFrame.src = LEARNING_ORIGIN + ${JSON.stringify(paths.learningHtml)};
    packageFrame.src = PACKAGE_ORIGIN + ${JSON.stringify(paths.packageHtml)};

    window.offlineScormPrototype = {
      events: () => structuredClone(events),
      command: (target, action, detail) => {
        const frame = target === "learning" ? learningFrame : packageFrame;
        const origin = target === "learning" ? LEARNING_ORIGIN : PACKAGE_ORIGIN;
        frame.contentWindow.postMessage(
          { type: "prototype-command", action, detail },
          origin,
        );
      },
      reloadPackage: () => {
        packageReady = false;
        packageFrame.src = PACKAGE_ORIGIN + ${JSON.stringify(paths.packageHtml)};
      },
      addCompetitor: () => {
        const competitor = document.createElement("iframe");
        competitor.id = "package-competitor";
        competitor.title = "Competing package player";
        competitor.setAttribute("sandbox", ${JSON.stringify(packageFrameSandbox)});
        competitor.src = PACKAGE_ORIGIN + ${JSON.stringify(paths.packageHtml)};
        document.body.append(competitor);
      },
      origins: { application: APPLICATION_ORIGIN, learning: LEARNING_ORIGIN, package: PACKAGE_ORIGIN },
    };
  })();
  `;
}

function learningScript({ applicationOrigin }) {
  return `(() => {
    "use strict";
    const APPLICATION_ORIGIN = ${JSON.stringify(applicationOrigin)};
    let port;
    let acknowledge = true;
    const pending = [];
    document.cookie = "learning_session=learning-only; SameSite=Strict";

    function sendAcknowledgement(entry) {
      port?.postMessage({
        type: "offline-scorm-import-acknowledgement",
        protocolVersion: 1,
        spoolEntryId: entry.spoolEntryId,
        status: "protected",
      });
    }

    function acceptPort(nextPort) {
      port?.close();
      port = nextPort;
      port.onmessage = (event) => {
        if (event.data?.type !== "offline-scorm-spool-entry") return;
        const entry = event.data.entry;
        parent.postMessage(
          { type: "prototype-learning-received", spoolEntryId: entry.spoolEntryId },
          APPLICATION_ORIGIN,
        );
        if (acknowledge) sendAcknowledgement(entry);
        else pending.push(entry);
      };
      port.start();
    }

    window.addEventListener("message", (event) => {
      if (event.source !== parent || event.origin !== APPLICATION_ORIGIN) return;
      if (
        event.data?.type === "offline-scorm-sibling-channel" &&
        event.data.protocolVersion === 1 &&
        event.ports.length === 1
      ) {
        acceptPort(event.ports[0]);
        return;
      }
      if (event.data?.type !== "prototype-command") return;
      if (event.data.action === "acknowledge") {
        acknowledge = Boolean(event.data.detail);
        if (acknowledge && port)
          for (const entry of pending.splice(0)) sendAcknowledgement(entry);
      }
    });

    parent.postMessage(
      {
        type: "offline-scorm-sibling-ready",
        protocolVersion: 1,
        role: "learning",
        cookie: document.cookie,
      },
      APPLICATION_ORIGIN,
    );
  })();
  `;
}

function packageScript({ applicationOrigin }) {
  return `(() => {
    "use strict";
    const APPLICATION_ORIGIN = ${JSON.stringify(applicationOrigin)};
    const VENDOR_PATH = ${JSON.stringify(paths.vendorHtml)};
    const SPOOL_KEY = "upskill-offline-scorm-spool-v1";
    const LOCK_NAME = "upskill-offline-scorm-exact-attempt-v1";
    const status = document.getElementById("package-status");
    const vendorFrame = document.getElementById("vendor-frame");
    let port;
    let releaseLock;
    let cacheReady = false;
    let preparingPackage;
    let values = Object.create(null);
    let initialized = false;
    let launchReady = false;
    let lockHeld = false;
    const safariQualification =
      /AppleWebKit/u.test(navigator.userAgent) &&
      !/(?:Chrome|Chromium|CriOS|Edg)/u.test(navigator.userAgent);

    function report(event) {
      status.textContent = event.type;
      parent.postMessage(event, APPLICATION_ORIGIN);
    }

    function readSpool() {
      const value = localStorage.getItem(SPOOL_KEY);
      if (!value) return { schemaVersion: 1, nextOrdinal: 1, entries: [] };
      const parsed = JSON.parse(value);
      if (
        parsed?.schemaVersion !== 1 ||
        !Number.isInteger(parsed.nextOrdinal) ||
        !Array.isArray(parsed.entries) ||
        parsed.entries.length > 64
      ) throw new Error("Invalid package spool");
      return parsed;
    }

    function writeCheckpoint(reason) {
      if (!launchReady || !lockHeld) return "false";
      const spool = readSpool();
      if (spool.entries.length >= 64) return "false";
      const entry = {
        schemaVersion: 1,
        spoolEntryId: crypto.randomUUID().replaceAll("-", ""),
        ordinal: spool.nextOrdinal,
        reason,
        snapshot: {
          lessonStatus: values["cmi.core.lesson_status"] || "incomplete",
          location: values["cmi.core.lesson_location"] || "",
          suspendData: values["cmi.suspend_data"] || "",
          scoreRaw: null,
          scoreMin: null,
          scoreMax: null,
          totalTimeSeconds: 20,
        },
        launchSessionId: "prototype_launch_session_0001",
        sessionElapsedSeconds: 20,
        sessionTimeDeltaSeconds: spool.nextOrdinal === 1 ? 20 : 0,
        clientObservedAt: new Date().toISOString(),
      };
      const next = {
        schemaVersion: 1,
        nextOrdinal: spool.nextOrdinal + 1,
        entries: [...spool.entries, entry],
      };
      const serialized = JSON.stringify(next);
      if (new TextEncoder().encode(serialized).byteLength > 524288) return "false";
      localStorage.setItem(SPOOL_KEY, serialized);
      report({ type: "prototype-spool-staged", spoolEntryId: entry.spoolEntryId });
      drain();
      return "true";
    }

    function drain() {
      if (!port) return;
      for (const entry of readSpool().entries)
        port.postMessage({
          type: "offline-scorm-spool-entry",
          protocolVersion: 1,
          entry,
        });
    }

    function completeRecovery() {
      if (
        launchReady ||
        !lockHeld ||
        !port ||
        readSpool().entries.length !== 0
      ) return;
      launchReady = true;
      vendorFrame.src = VENDOR_PATH;
      report({ type: "prototype-player-ready" });
    }

    window.API = {
      LMSInitialize: () => {
        if (!launchReady || !lockHeld || readSpool().entries.length !== 0)
          return "false";
        initialized = true;
        return "true";
      },
      LMSSetValue: (name, value) => {
        if (!initialized || typeof name !== "string" || typeof value !== "string")
          return "false";
        values[name] = value;
        return "true";
      },
      LMSCommit: () => initialized ? writeCheckpoint("commit") : "false",
      LMSFinish: () => initialized ? writeCheckpoint("finish") : "false",
      LMSGetValue: (name) => values[name] || "",
      LMSGetLastError: () => "0",
      LMSGetErrorString: () => "No error",
      LMSGetDiagnostic: () => "No error",
    };

    async function installPackage() {
      const registration = await navigator.serviceWorker.register(
        ${JSON.stringify(paths.packageWorker)},
        { scope: ${JSON.stringify(`${OFFLINE_SCORM_PROTOTYPE_PREFIX}/`)} },
      );
      await navigator.serviceWorker.ready;
      const worker = registration.active || registration.waiting || registration.installing;
      if (!worker) throw new Error("Package worker unavailable");
      await new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
          if (event.data?.status === "ready") resolve();
          else reject(new Error("Package install failed"));
        };
        worker.postMessage({ type: "prototype-install-package" }, [channel.port2]);
      });
      cacheReady = true;
    }

    function preparePackage() {
      preparingPackage ??= installPackage().then(acquireLock).catch(() => {
        preparingPackage = undefined;
        report({ type: "prototype-package-install-failed" });
      });
      return preparingPackage;
    }

    function acquireLock() {
      if (!navigator.locks) {
        report({ type: "prototype-lock-unsupported" });
        return;
      }
      void navigator.locks.request(
        LOCK_NAME,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) {
            report({ type: "prototype-lock-busy" });
            return;
          }
          lockHeld = true;
          launchReady = false;
          report({ type: "prototype-lock-acquired" });
          parent.postMessage(
            {
              type: "offline-scorm-sibling-ready",
              protocolVersion: 1,
              role: "package",
              cookie: document.cookie,
              cacheReady,
            },
            APPLICATION_ORIGIN,
          );
          await new Promise((resolve) => { releaseLock = resolve; });
          initialized = false;
          launchReady = false;
          lockHeld = false;
        },
      );
    }

    async function cleanup() {
      const spool = readSpool();
      if (spool.entries.length !== 0) {
        report({
          type: "prototype-cleanup-blocked",
          pendingEntries: spool.entries.length,
        });
        return;
      }
      initialized = false;
      launchReady = false;
      vendorFrame.removeAttribute("src");
      port?.close();
      port = undefined;
      const clearResponse = await fetch(${JSON.stringify(paths.clearSiteData)}, {
        cache: "no-store",
        credentials: "omit",
      });
      if (!clearResponse.ok) throw new Error("Whole-site cleanup was unavailable");
      for (const registration of await navigator.serviceWorker.getRegistrations())
        await registration.unregister();
      const databases = await indexedDB.databases();
      await Promise.all(databases.flatMap((database) => database.name ? [
        new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(database.name);
          request.onsuccess = resolve;
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error("Database deletion blocked"));
        }),
      ] : []));
      for (const name of await caches.keys()) await caches.delete(name);
      if (globalThis.cookieStore)
        for (const cookie of await globalThis.cookieStore.getAll())
          await globalThis.cookieStore.delete(cookie.name);
      for (const cookie of document.cookie.split(";")) {
        const separator = cookie.indexOf("=");
        const name = separator > 0 ? cookie.slice(0, separator).trim() : "";
        if (name)
          document.cookie = name + "=; Max-Age=0; Path=/; SameSite=Strict";
      }
      localStorage.clear();
      sessionStorage.clear();
      if (document.cookie) throw new Error("Package cookie cleanup failed");
      if (
        (await indexedDB.databases()).some((database) => database.name) ||
        (await caches.keys()).length > 0 ||
        (await navigator.serviceWorker.getRegistrations()).length > 0 ||
        localStorage.length > 0 ||
        sessionStorage.length > 0
      ) throw new Error("Package-site state remained after cleanup");
      releaseLock?.();
      report({ type: "prototype-cleanup-complete" });
    }

    window.addEventListener("message", (event) => {
      if (event.source === parent && event.origin === APPLICATION_ORIGIN) {
        if (
          event.data?.type === "offline-scorm-sibling-channel" &&
          event.data.protocolVersion === 1 &&
          event.ports.length === 1
        ) {
          port?.close();
          port = event.ports[0];
          port.onmessage = (portEvent) => {
            if (
              portEvent.data?.type !== "offline-scorm-import-acknowledgement" ||
              portEvent.data.status !== "protected"
            ) return;
            const spool = readSpool();
            const entries = spool.entries.filter(
              (entry) => entry.spoolEntryId !== portEvent.data.spoolEntryId,
            );
            localStorage.setItem(SPOOL_KEY, JSON.stringify({ ...spool, entries }));
            report({
              type: entries.length === 0 ? "prototype-spool-drained" : "prototype-spool-pending",
              spoolEntryId: portEvent.data.spoolEntryId,
            });
            if (entries.length === 0) completeRecovery();
          };
          port.start();
          if (readSpool().entries.length === 0) completeRecovery();
          else drain();
          return;
        }
        if (event.data?.type !== "prototype-command") return;
        if (event.data.action === "commit")
          vendorFrame.contentWindow.postMessage(
            { type: "prototype-vendor-commit" },
            location.origin,
          );
        else if (event.data.action === "cleanup") void cleanup();
      }
    });

    document.getElementById("enable-storage").addEventListener("click", async () => {
      try {
        if (document.requestStorageAccess && !(await document.hasStorageAccess?.()))
          await document.requestStorageAccess();
        const key = "prototype-storage-probe";
        localStorage.setItem(key, key);
        if (localStorage.getItem(key) !== key) throw new Error("Storage probe failed");
        localStorage.removeItem(key);
        report({
          type: document.requestStorageAccess
            ? "prototype-storage-access-granted"
            : "prototype-storage-access-not-required",
        });
        if (safariQualification) await preparePackage();
      } catch {
        report({ type: "prototype-storage-access-denied" });
      }
    });

    if (safariQualification)
      report({ type: "prototype-storage-access-required" });
    else void preparePackage();
  })();
  `;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function packageWorker(files, packageOrigin) {
  const inventory = [...files.entries()].map(([pathname, asset]) => ({
    pathname,
    sha256: sha256(asset.body),
    sizeBytes: Buffer.byteLength(asset.body),
  }));
  const packageDigest = sha256(JSON.stringify(inventory));
  return `"use strict";
const PACKAGE_ORIGIN = ${JSON.stringify(packageOrigin)};
const INVENTORY = ${JSON.stringify(inventory)};
const CACHE_NAME = ${JSON.stringify(`upskill-offline-scorm-package-v1-prototype-${packageDigest}`)};
const READY_URL = PACKAGE_ORIGIN + "/.__upskill_offline__/ready/${packageDigest}";

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function installPackage() {
  const existing = await caches.open(CACHE_NAME);
  if (await existing.match(READY_URL)) return;
  const stagingName = CACHE_NAME + "-staging-" + crypto.randomUUID();
  const staging = await caches.open(stagingName);
  try {
    for (const file of INVENTORY) {
      const request = new Request(PACKAGE_ORIGIN + file.pathname, {
        cache: "no-store",
        credentials: "omit",
      });
      const response = await fetch(request);
      if (!response.ok || response.type === "opaque") throw new Error("Unavailable file");
      const bytes = await response.arrayBuffer();
      const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
      if (bytes.byteLength !== file.sizeBytes || digest !== file.sha256)
        throw new Error("Integrity failure");
      await staging.put(request, new Response(bytes, { headers: response.headers }));
    }
    const published = await caches.open(CACHE_NAME);
    if (await published.match(READY_URL)) return;
    for (const file of INVENTORY) {
      const request = new Request(PACKAGE_ORIGIN + file.pathname, { credentials: "omit" });
      const response = await staging.match(request);
      if (!response) throw new Error("Staging entry missing");
      await published.put(request, response);
    }
    await published.put(READY_URL, new Response("ready"));
  } finally {
    await caches.delete(stagingName);
  }
}

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));
self.addEventListener("message", (event) => {
  if (event.data?.type !== "prototype-install-package" || event.ports.length !== 1) return;
  event.waitUntil(
    installPackage().then(
      () => event.ports[0].postMessage({ status: "ready" }),
      () => event.ports[0].postMessage({ status: "failed" }),
    ),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (
    url.origin !== PACKAGE_ORIGIN ||
    url.search !== "" ||
    url.hash !== "" ||
    !INVENTORY.some((file) => file.pathname === url.pathname)
  ) return;
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      if (!(await cache.match(READY_URL))) return fetch(event.request);
      const cached = await cache.match(event.request);
      return cached ?? Response.error();
    }),
  );
});
`;
}

function response(body, contentType, contentSecurityPolicy) {
  return {
    body,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": contentSecurityPolicy,
      "Content-Type": `${contentType}; charset=utf-8`,
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
    status: 200,
  };
}

function learningContentSecurityPolicy(applicationOrigin) {
  return `base-uri 'none'; connect-src 'self'; default-src 'self'; font-src 'self' data:; form-action 'none'; frame-ancestors 'self' ${applicationOrigin}; frame-src 'self' https://embed.articulateusercontent.com; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; worker-src 'self' blob:`;
}

export function getOfflineScormPrototypeAsset(requestUrl, configuration) {
  if (configuration.environment !== "test") return null;
  const { applicationOrigin, learningOrigin, packageOrigin } = configuration;
  const origin = requestUrl.origin;
  const pathname = requestUrl.pathname;
  const applicationCsp = `default-src 'none'; script-src 'self'; frame-src ${learningOrigin} ${packageOrigin}; base-uri 'none'; form-action 'none'`;
  const learningCsp = `default-src 'none'; script-src 'self'; frame-ancestors ${applicationOrigin}; base-uri 'none'; form-action 'none'`;
  const packageCsp = learningContentSecurityPolicy(applicationOrigin);
  const vendorCsp = learningContentSecurityPolicy(applicationOrigin);
  const packageWorkerCsp = "default-src 'none'; connect-src 'self'";

  if (origin === applicationOrigin && pathname === paths.applicationHtml)
    return response(
      page(
        "Offline SCORM package prototype",
        paths.applicationScript,
        `<main><p id="status" role="status">Starting prototype</p><iframe id="learning-frame" title="Trusted learning runtime"></iframe><iframe id="package-frame" title="Exact-attempt package" sandbox="${packageFrameSandbox}"></iframe></main>`,
      ),
      "text/html",
      applicationCsp,
    );
  if (origin === applicationOrigin && pathname === paths.applicationScript)
    return response(
      applicationScript(configuration),
      "text/javascript",
      applicationCsp,
    );
  if (origin === learningOrigin && pathname === paths.learningHtml)
    return response(
      page(
        "Trusted learning prototype",
        paths.learningScript,
        '<p id="learning-ready">Trusted runtime ready</p>',
      ),
      "text/html",
      learningCsp,
    );
  if (origin === learningOrigin && pathname === paths.learningScript)
    return response(
      learningScript(configuration),
      "text/javascript",
      learningCsp,
    );

  if (origin !== packageOrigin) return null;
  if (pathname === paths.clearSiteData)
    return {
      ...response("cleared", "text/plain", "default-src 'none'"),
      headers: {
        ...response("", "text/plain", "default-src 'none'").headers,
        "Clear-Site-Data": '"cache", "cookies", "storage"',
      },
    };
  const packageAssets = new Map([
    [
      paths.packageHtml,
      {
        body: page(
          "Exact-attempt package prototype",
          paths.packageScript,
          '<main><p id="package-status" role="status">Preparing package</p><button id="enable-storage" type="button">Enable offline course</button><iframe id="vendor-frame" title="Rise package fixture"></iframe></main>',
        ),
        contentType: "text/html",
        csp: packageCsp,
      },
    ],
    [
      paths.packageScript,
      {
        body: packageScript(configuration),
        contentType: "text/javascript",
        csp: packageCsp,
      },
    ],
    [
      paths.vendorHtml,
      { body: vendorHtml, contentType: "text/html", csp: vendorCsp },
    ],
    [
      paths.vendorScript,
      { body: vendorScript, contentType: "text/javascript", csp: vendorCsp },
    ],
  ]);
  const asset = packageAssets.get(pathname);
  if (asset) return response(asset.body, asset.contentType, asset.csp);
  if (pathname === paths.packageWorker)
    return {
      ...response(
        packageWorker(packageAssets, packageOrigin),
        "text/javascript",
        packageWorkerCsp,
      ),
      headers: {
        ...response("", "text/javascript", packageWorkerCsp).headers,
        "Service-Worker-Allowed": `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/`,
      },
    };
  return null;
}
