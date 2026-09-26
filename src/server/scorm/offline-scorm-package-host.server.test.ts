import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOfflineScormPackageHostHandler } from "./offline-scorm-package-host.server";

const packageLabel = `p-${"a".repeat(56)}`;
const packageOrigin = `https://${packageLabel}.github.io`;
const fileSha256 = "b".repeat(64);

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
  const getObject = vi.fn();

  beforeEach(() => {
    findAuthorizedPackage.mockReset();
    getObject.mockReset();
  });

  function handler(enabled = true) {
    return createOfflineScormPackageHostHandler({
      configuration: {
        applicationOrigin: "https://app.example.com",
        environment: "production",
        learningOrigin: "https://learn.example.net",
        learningBucket: "learning-bucket",
        packageHostSuffix: "github.io",
        enabled,
      },
      findAuthorizedPackage,
      getObject,
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
