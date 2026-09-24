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

    const cleanup = asset(
      configuration.packageOrigin,
      `${OFFLINE_SCORM_PROTOTYPE_PREFIX}/clear-site-data`,
    );
    expect(cleanup?.headers["Clear-Site-Data"]).toBe(
      '"cache", "cookies", "storage"',
    );
  });
});
