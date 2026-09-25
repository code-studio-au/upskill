import { describe, expect, it } from "vitest";
import { buildLearningContentSecurityPolicy } from "../src/features/scorm/learning-content-security-policy.ts";
import {
  getOfflineScormPrototypeAsset,
  OFFLINE_SCORM_PROTOTYPE_PREFIX,
} from "./offline-scorm-package-prototype-assets.mjs";

const configuration = {
  applicationOrigin: "http://127.0.0.1:3000",
  learningOrigin: "http://127.0.0.1:3001",
  packageOrigin: "http://127.0.0.2:3002",
  environment: "test",
};

function asset(origin, pathname, overrides = {}) {
  return getOfflineScormPrototypeAsset(new URL(pathname, origin), {
    ...configuration,
    ...overrides,
  });
}

describe("offline SCORM package prototype assets", () => {
  it("keeps the qualification harness test-only and origin-specific", () => {
    expect(
      asset(
        configuration.applicationOrigin,
        `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/application.html`,
        { environment: "production" },
      ),
    ).toBeNull();
    expect(
      asset(
        configuration.learningOrigin,
        `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/application.html`,
      ),
    ).toBeNull();
    expect(
      asset(
        configuration.packageOrigin,
        `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/package.html`,
      ),
    ).toMatchObject({
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  });

  it("uses exact-origin sibling channels without identity selectors", () => {
    const coordinator = asset(
      configuration.applicationOrigin,
      `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/application.js`,
    );
    expect(coordinator?.body).toContain(configuration.learningOrigin);
    expect(coordinator?.body).toContain(configuration.packageOrigin);
    expect(coordinator?.body).toContain(
      "event.source === packageFrame.contentWindow",
    );
    expect(coordinator?.body).toContain(
      'type: "offline-scorm-sibling-channel"',
    );
    expect(coordinator?.body).not.toContain("entitlementId");
    expect(coordinator?.body).not.toContain("attemptId");
    expect(coordinator?.body).not.toContain('postMessage(message, "*"');
    expect(coordinator?.body).toContain(
      'competitor.setAttribute("sandbox", "allow-downloads allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation")',
    );
  });

  it("sandboxes every direct package frame with the production capabilities", () => {
    const application = asset(
      configuration.applicationOrigin,
      `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/application.html`,
    );
    expect(application?.body).toContain(
      'id="package-frame" title="Exact-attempt package" sandbox="allow-downloads allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation"',
    );
  });

  it("publishes only digest-checked package files behind a ready marker", () => {
    const worker = asset(
      configuration.packageOrigin,
      `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/package-worker.js`,
    );
    expect(worker).toMatchObject({
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/javascript; charset=utf-8",
        "Service-Worker-Allowed": `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/`,
      },
    });
    expect(worker?.body).toContain('crypto.subtle.digest("SHA-256", bytes)');
    expect(worker?.body).toContain('credentials: "omit"');
    expect(worker?.body).toContain("await published.put(READY_URL");
    expect(worker?.body).toContain("crypto.randomUUID()");
    expect(worker?.body).not.toContain("await caches.delete(CACHE_NAME)");
    expect(worker?.body).toContain(
      "async function verifyResponse(response, file)",
    );
    expect(worker?.body).toContain("async function isReadyCacheValid(cache)");
    expect(worker?.body).toContain(
      "if (await isReadyCacheValid(existing)) return",
    );
    expect(worker?.body).toContain(
      "if (await isReadyCacheValid(published)) return",
    );
    expect(worker?.body).toContain(
      "if (!(await isReadyCacheValid(published))) throw new Error",
    );
    expect(worker?.body).not.toContain(
      "if (await existing.match(READY_URL)) return",
    );
    expect(worker?.body).toContain("await response.arrayBuffer()");
    expect(worker?.body).toContain(
      "bytes.byteLength !== file.sizeBytes || digest !== file.sha256",
    );
    expect(worker?.body).toContain(
      "return (await verifyResponse(response, file)) ?? Response.error()",
    );
    expect(worker?.body).toContain(
      "await fetch(new Request(PACKAGE_ORIGIN + file.pathname",
    );
    expect(worker?.body).toContain("return trustedResponse(bytes, file)");
    expect(worker?.body).toContain('"Cache-Control": "no-store"');
    expect(worker?.body).toContain(
      '"Content-Security-Policy": file.contentSecurityPolicy',
    );
    expect(worker?.body).toContain('"Content-Type": file.contentType');
    expect(worker?.body).toContain(
      '"Cross-Origin-Resource-Policy": "same-origin"',
    );
    expect(worker?.body).toContain('"Referrer-Policy": "no-referrer"');
    expect(worker?.body).toContain('"X-Content-Type-Options": "nosniff"');
    expect(worker?.body).not.toContain("return cached;");
    expect(worker?.body).not.toContain("return fetch(event.request)");
    expect(worker?.body).not.toContain(
      "(await cache.match(event.request)) || fetch(event.request)",
    );
  });

  it("qualifies the supported Rise content policy", () => {
    const vendor = asset(
      configuration.packageOrigin,
      `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/vendor.html`,
    );
    expect(vendor?.headers["Content-Security-Policy"]).toBe(
      buildLearningContentSecurityPolicy(configuration.applicationOrigin),
    );
    expect(vendor?.headers["Content-Security-Policy"]).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );
    expect(vendor?.headers["Content-Security-Policy"]).toContain(
      "frame-src 'self' https://embed.articulateusercontent.com",
    );
    expect(vendor?.body).toContain("eval(\"'Rise fixture ready'\")");
    expect(vendor?.body).toContain("<style>");
  });

  it("loads vendor content only after lock ownership and spool recovery", () => {
    const packagePage = asset(
      configuration.packageOrigin,
      `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/package.html`,
    );
    const packageRuntime = asset(
      configuration.packageOrigin,
      `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/package.js`,
    );
    expect(packagePage?.body).toContain(
      '<iframe id="vendor-frame" title="Rise package fixture"></iframe>',
    );
    expect(packagePage?.body).not.toContain('id="vendor-frame" src=');
    expect(packageRuntime?.body).toContain("!lockHeld");
    expect(packageRuntime?.body).toContain("readSpool().entries.length !== 0");
    expect(packageRuntime?.body).toContain("vendorFrame.src = VENDOR_PATH");
    expect(packageRuntime?.body).toContain('type: "prototype-player-ready"');
  });

  it("keeps the synchronous spool bounded and provides whole-site cleanup", () => {
    const packageRuntime = asset(
      configuration.packageOrigin,
      `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/package.js`,
    );
    expect(packageRuntime?.body).toContain("parsed.entries.length > 64");
    expect(packageRuntime?.body).toContain("localStorage.setItem(SPOOL_KEY");
    expect(packageRuntime?.body).toContain("await indexedDB.databases()");
    expect(packageRuntime?.body).toContain("await caches.keys()");
    expect(packageRuntime?.body).toContain(
      "await navigator.serviceWorker.getRegistrations()",
    );
    expect(packageRuntime?.body).toContain(
      "await globalThis.cookieStore.getAll()",
    );
    expect(packageRuntime?.body).toContain("document.cookie.split");
    expect(packageRuntime?.body).toContain("document.requestStorageAccess");
    expect(packageRuntime?.body).toContain(
      'const replacementValue = key + "-replacement"',
    );
    expect(packageRuntime?.body).toContain(
      "localStorage.getItem(key) !== replacementValue",
    );
    expect(packageRuntime?.body).toContain(
      "localStorage.getItem(key) !== null",
    );
    const cleanupGuard = packageRuntime?.body.indexOf(
      'type: "prototype-cleanup-blocked"',
    );
    const clearSiteDataRequest = packageRuntime?.body.indexOf(
      `fetch("${OFFLINE_SCORM_PROTOTYPE_PREFIX}/clear-site-data"`,
    );
    expect(cleanupGuard).toBeGreaterThan(-1);
    expect(clearSiteDataRequest).toBeGreaterThan(cleanupGuard ?? -1);

    const cleanup = asset(
      configuration.packageOrigin,
      `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/clear-site-data`,
    );
    expect(cleanup?.headers["Clear-Site-Data"]).toBe(
      '"cache", "cookies", "storage"',
    );
  });
});
