import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOfflineScormPackageHostHandler } from "./offline-scorm-package-host.server";
import {
  createOfflineScormPackageCleanupCapability,
  createOfflineScormPackageCleanupReceipt,
} from "./offline-scorm-package-site.server";

const packageLabel = `p-${"a".repeat(56)}`;
const packageOrigin = `https://${packageLabel}.github.io`;
const fileSha256 = "b".repeat(64);
const packageSiteOriginKey = Buffer.alloc(32, 7).toString("base64url");

function storedObject(body = "hello") {
  return {
    body: new Blob([body]).stream(),
    cacheControl: undefined,
    contentLength: body.length,
    contentRange: undefined,
    contentType: "text/html; charset=utf-8",
    etag: undefined,
  };
}

describe("offline SCORM credential-free package host", () => {
  const findAuthorizedPackage = vi.fn();
  const findAuthorizedRuntime = vi.fn();
  const getObject = vi.fn();
  const readRuntimeAsset = vi.fn(() => Promise.resolve("runtime"));

  beforeEach(() => {
    findAuthorizedPackage.mockReset();
    findAuthorizedRuntime.mockReset();
    getObject.mockReset();
    readRuntimeAsset.mockClear();
  });

  function handler(enabled = true) {
    return createOfflineScormPackageHostHandler({
      configuration: {
        applicationOrigin: "https://app.example.com",
        environment: "production",
        learningOrigin: "https://learn.example.net",
        learningBucket: "learning-bucket",
        packageHostSuffix: "github.io",
        packageSiteOriginKey,
        enabled,
      },
      findAuthorizedPackage,
      findAuthorizedRuntime,
      getObject,
      readRuntimeAsset,
      now: () => new Date("2026-09-26T00:00:00.000Z"),
    });
  }

  function authorize() {
    findAuthorizedPackage.mockResolvedValue({
      contentPrefix: "scorm/packages/version-one",
      entitlementPackageSha256: "c".repeat(64),
      manifest: {
        files: [
          {
            path: "index.html",
            sha256: fileSha256,
            sizeBytes: 5,
            contentType: "text/html; charset=utf-8",
          },
        ],
      },
      packageSha256: "c".repeat(64),
    });
  }

  it("leaves application and learning origins to the normal router", async () => {
    await expect(
      handler()(new Request("https://app.example.com/index.html")),
    ).resolves.toBeNull();
    await expect(
      handler()(new Request("https://learn.example.net/api/scorm/runtime")),
    ).resolves.toBeNull();
    const overlappingSuffixHandler = createOfflineScormPackageHostHandler({
      configuration: {
        applicationOrigin: "https://app.github.io",
        environment: "production",
        learningOrigin: "https://learn.github.io",
        learningBucket: "learning-bucket",
        packageHostSuffix: "github.io",
        enabled: true,
      },
      findAuthorizedPackage,
      getObject,
    });
    await expect(
      overlappingSuffixHandler(
        new Request("https://app.github.io/assets/application.js"),
      ),
    ).resolves.toBeNull();
    await expect(
      overlappingSuffixHandler(
        new Request("https://learn.github.io/api/scorm/runtime"),
      ),
    ).resolves.toBeNull();
    expect(findAuthorizedPackage).not.toHaveBeenCalled();
  });

  it("claims every configured wildcard request but fails closed while disabled", async () => {
    const response = await handler(false)(
      new Request(`${packageOrigin}/index.html`, {
        headers: {
          Authorization: "Bearer must-not-be-needed",
          Cookie: "must_not_be_needed=true",
        },
      }),
    );
    expect(response?.status).toBe(404);
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(response?.headers.get("set-cookie")).toBeNull();
    expect(findAuthorizedPackage).not.toHaveBeenCalled();

    const invalidLabel = await handler()(
      new Request("https://not-an-allocation.github.io/index.html"),
    );
    expect(invalidLabel?.status).toBe(404);
    expect(findAuthorizedPackage).not.toHaveBeenCalled();
  });

  it("serves only an active exact-origin file in the immutable inventory", async () => {
    authorize();
    getObject.mockResolvedValue(storedObject());
    const response = await handler()(
      new Request(`${packageOrigin}/index.html`, {
        headers: {
          Authorization: "Bearer ignored",
          Cookie: "ignored=true",
        },
      }),
    );

    expect(response?.status).toBe(200);
    await expect(response?.text()).resolves.toBe("hello");
    expect(findAuthorizedPackage).toHaveBeenCalledWith(
      packageOrigin,
      new Date("2026-09-26T00:00:00.000Z"),
    );
    expect(getObject).toHaveBeenCalledWith(
      "learning-bucket",
      "scorm/packages/version-one/index.html",
      undefined,
    );
    expect(response?.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable, no-transform",
    );
    expect(response?.headers.get("etag")).toBe(`"sha256-${fileSha256}"`);
    expect(response?.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'self' https://app.example.com",
    );
    expect(response?.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response?.headers.get("x-frame-options")).toBeNull();
    expect(response?.headers.get("set-cookie")).toBeNull();
  });

  it("does not turn the private bucket into an arbitrary object proxy", async () => {
    authorize();
    const response = await handler()(
      new Request(`${packageOrigin}/not-in-the-manifest.js`),
    );
    expect(response?.status).toBe(404);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("rejects inactive origins and unsafe methods without exposing app routes", async () => {
    findAuthorizedPackage.mockResolvedValue(undefined);
    const inactive = await handler()(
      new Request(`${packageOrigin}/index.html`),
    );
    expect(inactive?.status).toBe(404);

    const appRoute = await handler()(
      new Request(`${packageOrigin}/admin`, { method: "POST" }),
    );
    expect(appRoute?.status).toBe(405);
    expect(appRoute?.headers.get("allow")).toBe("GET, HEAD");
  });

  it("keeps reviewed cleanup runtime assets available after launch expiry", async () => {
    findAuthorizedRuntime.mockResolvedValue({
      cleanupState: "pending",
      entitlementId: "entitlement_active",
      entitlementStatus: "active",
      intendedLaunchExpiresAt: new Date("2026-09-27T00:00:00.000Z"),
    });
    const host = await handler()(
      new Request(`${packageOrigin}/.__upskill_offline__/host.html`),
    );
    expect(host?.status).toBe(200);
    await expect(host?.text()).resolves.toContain(
      'data-learning-origin="https://learn.example.net"',
    );
    const worker = await handler()(
      new Request(`${packageOrigin}/.__upskill_offline__/worker.js`),
    );
    expect(worker?.status).toBe(200);
    expect(worker?.headers.get("service-worker-allowed")).toBe("/");
    expect(readRuntimeAsset).toHaveBeenCalledWith("package-worker.js");

    const rollbackHost = await handler(false)(
      new Request(`${packageOrigin}/.__upskill_offline__/host.html`),
    );
    expect(rollbackHost?.status).toBe(200);

    findAuthorizedRuntime.mockResolvedValue({
      cleanupState: "pending",
      entitlementId: "entitlement_expired",
      entitlementStatus: "active",
      intendedLaunchExpiresAt: new Date("2026-09-25T00:00:00.000Z"),
    });
    await expect(
      handler()(new Request(`${packageOrigin}/.__upskill_offline__/host.html`)),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("authorizes whole-site cleanup only for the trusted learning origin", async () => {
    const entitlementId = "entitlement_cleanup";
    findAuthorizedRuntime.mockResolvedValue({
      cleanupState: "clearing",
      entitlementId,
      entitlementStatus: "resolved",
      intendedLaunchExpiresAt: new Date("2026-09-25T00:00:00.000Z"),
    });
    const cleanupCapability = createOfflineScormPackageCleanupCapability(
      {
        OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY: packageSiteOriginKey,
      },
      { entitlementId, packageSiteOrigin: packageOrigin },
    );
    const denied = await handler()(
      new Request(
        `${packageOrigin}/.__upskill_offline__/clear-site-data?capability=${cleanupCapability}`,
        { method: "POST", headers: { Origin: "https://app.example.com" } },
      ),
    );
    expect(denied?.status).toBe(404);

    const cleared = await handler()(
      new Request(
        `${packageOrigin}/.__upskill_offline__/clear-site-data?capability=${cleanupCapability}`,
        {
          method: "POST",
          headers: { Origin: "https://learn.example.net" },
        },
      ),
    );
    expect(cleared?.status).toBe(200);
    expect(cleared?.headers.get("clear-site-data")).toBe(
      '"cache", "cookies", "storage"',
    );
    expect(cleared?.headers.get("access-control-allow-origin")).toBe(
      "https://learn.example.net",
    );
    await expect(cleared?.json()).resolves.toEqual({
      cleanupReceiptSha256: createOfflineScormPackageCleanupReceipt(
        {
          OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY: packageSiteOriginKey,
        },
        { entitlementId, packageSiteOrigin: packageOrigin },
      ),
    });

    const clearedAfterRollback = await handler(false)(
      new Request(
        `${packageOrigin}/.__upskill_offline__/clear-site-data?capability=${cleanupCapability}`,
        {
          method: "POST",
          headers: { Origin: "https://learn.example.net" },
        },
      ),
    );
    expect(clearedAfterRollback?.status).toBe(200);
  });

  it("honours bounded ranges and immutable conditional requests", async () => {
    authorize();
    getObject.mockResolvedValue({
      ...storedObject("ell"),
      contentLength: 3,
      contentRange: "bytes 1-3/5",
    });
    const partial = await handler()(
      new Request(`${packageOrigin}/index.html`, {
        headers: { Range: "bytes=1-3" },
      }),
    );
    expect(partial?.status).toBe(206);
    expect(partial?.headers.get("content-range")).toBe("bytes 1-3/5");
    expect(getObject).toHaveBeenCalledWith(
      "learning-bucket",
      "scorm/packages/version-one/index.html",
      "bytes=1-3",
    );

    getObject.mockClear();
    const unchanged = await handler()(
      new Request(`${packageOrigin}/index.html`, {
        headers: { "If-None-Match": `"sha256-${fileSha256}"` },
      }),
    );
    expect(unchanged?.status).toBe(304);
    expect(getObject).not.toHaveBeenCalled();

    const invalidRange = await handler()(
      new Request(`${packageOrigin}/index.html`, {
        headers: { Range: "bytes=1-2,4-5" },
      }),
    );
    expect(invalidRange?.status).toBe(416);
    expect(getObject).not.toHaveBeenCalled();
  });
});
