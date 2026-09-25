import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { OfflineScormPackagePrototypeError } from "#/features/scorm/offline-scorm-package-prototype";
import {
  assertOfflineScormPackageSiteIsolation,
  bindOfflineScormSiblingChannel,
  cleanupOfflineScormPackageSite,
  holdOfflineScormPackageLock,
  installOfflineScormPackage,
  isExpectedOfflineScormSiblingReady,
  matchInstalledOfflineScormPackage,
  OFFLINE_SCORM_PACKAGE_LOCK_NAME,
  OfflineScormPackageSpool,
  requestOfflineScormPackageStorageAccess,
  type OfflineScormPackageManifest,
} from "#/features/scorm/offline-scorm-package-prototype";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  readonly values = new Map<string, string>();
  getItem = vi.fn((key: string) => this.values.get(key) ?? null);
  setItem = vi.fn((key: string, value: string) => {
    this.values.set(key, value);
  });
}

class MemoryCache {
  readonly values = new Map<string, Response>();
  putHook?: (
    key: string,
    response: Response,
    commit: () => void,
  ) => Promise<void>;

  match(request: RequestInfo | URL): Promise<Response | undefined> {
    const key =
      request instanceof Request
        ? request.url
        : new URL(request.toString()).href;
    return Promise.resolve(this.values.get(key)?.clone());
  }

  put(request: RequestInfo | URL, response: Response): Promise<void> {
    const key =
      request instanceof Request
        ? request.url
        : new URL(request.toString()).href;
    const commit = () => {
      this.values.set(key, response.clone());
    };
    if (this.putHook) return this.putHook(key, response, commit);
    commit();
    return Promise.resolve();
  }
}

class MemoryCacheStorage {
  readonly stores = new Map<string, MemoryCache>();

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.stores.delete(name));
  }

  open(name: string): Promise<MemoryCache> {
    const existing = this.stores.get(name);
    if (existing) return Promise.resolve(existing);
    const created = new MemoryCache();
    this.stores.set(name, created);
    return Promise.resolve(created);
  }

  match(
    request: RequestInfo | URL,
    options?: MultiCacheQueryOptions,
  ): Promise<Response | undefined> {
    const cacheName = options?.cacheName;
    if (cacheName)
      return (
        this.stores.get(cacheName)?.match(request) ?? Promise.resolve(undefined)
      );
    return Promise.resolve(undefined);
  }
}

const snapshot = {
  lessonStatus: "incomplete" as const,
  location: "slide-2",
  suspendData: "bounded-state",
  scoreRaw: 50,
  scoreMin: 0,
  scoreMax: 100,
  totalTimeSeconds: 20,
};

function checkpoint(
  overrides: Partial<
    Parameters<OfflineScormPackageSpool["appendCheckpoint"]>[0]
  > = {},
): Parameters<OfflineScormPackageSpool["appendCheckpoint"]>[0] {
  return {
    spoolEntryId: "spool_entry_000001",
    reason: "commit",
    snapshot,
    launchSessionId: "launch_session_000001",
    sessionElapsedSeconds: 20,
    clientObservedAt: "2026-09-23T01:02:03.000Z",
    ...overrides,
  };
}

function packageManifest(
  files: Record<string, { body: string; contentType: string }>,
): OfflineScormPackageManifest {
  return {
    schemaVersion: 1,
    packageVersionId: "package_version_1",
    packageSha256: "a".repeat(64),
    runtimeVersion: "offline-scorm-1",
    packageOrigin: "https://attempt-package.test",
    entrypointPath: "/index.html",
    files: Object.entries(files).map(([pathname, file]) => ({
      pathname,
      sha256: createHash("sha256").update(file.body).digest("hex"),
      sizeBytes: new TextEncoder().encode(file.body).byteLength,
      contentType: file.contentType,
    })),
  };
}

describe("isolated offline SCORM package prototype", () => {
  it("requires the exact-attempt package origin to use another schemeful site", () => {
    expect(() => {
      assertOfflineScormPackageSiteIsolation({
        applicationOrigin: "https://app.upskill.example",
        learningOrigin: "https://learn.upskill.example",
        packageOrigin: "https://attempt-package.example.net",
      });
    }).not.toThrow();
    expect(() => {
      assertOfflineScormPackageSiteIsolation({
        applicationOrigin: "http://127.0.0.1:3000",
        learningOrigin: "http://127.0.0.1:3001",
        packageOrigin: "http://127.0.0.2:3002",
      });
    }).not.toThrow();
    expect(() => {
      assertOfflineScormPackageSiteIsolation({
        applicationOrigin: "https://app.upskill.example",
        learningOrigin: "https://learn.upskill.example",
        packageOrigin: "https://attempt.upskill.example",
      });
    }).toThrow(
      expect.objectContaining<Partial<OfflineScormPackagePrototypeError>>({
        code: "invalid_origin",
      }),
    );
    expect(() => {
      assertOfflineScormPackageSiteIsolation({
        applicationOrigin: "https://app.upskill.example",
        learningOrigin: "https://learn.upskill.example",
        packageOrigin: "http://attempt-package.example.net",
      });
    }).toThrow(
      expect.objectContaining<Partial<OfflineScormPackagePrototypeError>>({
        code: "invalid_origin",
      }),
    );
  });

  it("atomically stages bounded checkpoints and preserves launch high-water state", () => {
    const storage = new MemoryStorage();
    const spool = new OfflineScormPackageSpool(storage);
    spool.beginLaunch("launch_session_000001");

    expect(spool.appendCheckpoint(checkpoint())).toMatchObject({
      ordinal: 1,
      sessionElapsedSeconds: 20,
      sessionTimeDeltaSeconds: 20,
    });
    expect(
      spool.appendCheckpoint(
        checkpoint({
          spoolEntryId: "spool_entry_000002",
          sessionElapsedSeconds: 20,
        }),
      ),
    ).toMatchObject({ ordinal: 2, sessionTimeDeltaSeconds: 0 });
    expect(new OfflineScormPackageSpool(storage).listEntries()).toHaveLength(2);
    expect(() =>
      spool.appendCheckpoint(
        checkpoint({
          spoolEntryId: "spool_entry_000002",
          sessionElapsedSeconds: 21,
        }),
      ),
    ).toThrow(
      expect.objectContaining<Partial<OfflineScormPackagePrototypeError>>({
        code: "spool_corrupt",
      }),
    );

    const beforeRegression = storage.values.values().next().value;
    expect(() =>
      spool.appendCheckpoint(
        checkpoint({
          spoolEntryId: "spool_entry_000003",
          sessionElapsedSeconds: 19,
        }),
      ),
    ).toThrow(
      expect.objectContaining<Partial<OfflineScormPackagePrototypeError>>({
        code: "spool_corrupt",
      }),
    );
    expect(storage.values.values().next().value).toBe(beforeRegression);

    spool.acknowledge("spool_entry_000001");
    expect(spool.listEntries().map((entry) => entry.spoolEntryId)).toEqual([
      "spool_entry_000002",
    ]);
    expect(() => {
      spool.beginLaunch("launch_session_000002");
    }).toThrow(
      expect.objectContaining<Partial<OfflineScormPackagePrototypeError>>({
        code: "spool_corrupt",
      }),
    );
    spool.acknowledge("spool_entry_000002");
    spool.beginLaunch("launch_session_000002");
    expect(
      spool.appendCheckpoint(
        checkpoint({
          launchSessionId: "launch_session_000002",
          spoolEntryId: "spool_entry_000003",
          sessionElapsedSeconds: 5,
        }),
      ),
    ).toMatchObject({ ordinal: 1, sessionTimeDeltaSeconds: 5 });
  });

  it("fails a synchronous checkpoint before exceeding spool limits", () => {
    const storage = new MemoryStorage();
    const spool = new OfflineScormPackageSpool(storage, { recordLimit: 1 });
    spool.beginLaunch("launch_session_000001");
    spool.appendCheckpoint(checkpoint());
    const committed = storage.values.values().next().value;

    expect(() =>
      spool.appendCheckpoint(
        checkpoint({ spoolEntryId: "spool_entry_000002" }),
      ),
    ).toThrow(
      expect.objectContaining<Partial<OfflineScormPackagePrototypeError>>({
        code: "spool_full",
      }),
    );
    expect(storage.values.values().next().value).toBe(committed);
  });

  it("rejects stored spool state above the configured byte ceiling", () => {
    const storage = new MemoryStorage();
    storage.values.set(
      "upskill-offline-scorm-spool-v1",
      `${JSON.stringify({
        schemaVersion: 1,
        nextOrdinal: 1,
        activeLaunch: null,
        entries: [],
      })}${" ".repeat(128)}`,
    );
    const spool = new OfflineScormPackageSpool(storage, { byteLimit: 128 });

    expect(() => spool.listEntries()).toThrow(
      expect.objectContaining<Partial<OfflineScormPackagePrototypeError>>({
        code: "spool_corrupt",
      }),
    );
  });

  it("does not advance spool state when Web Storage rejects the write", () => {
    const storage = new MemoryStorage();
    const spool = new OfflineScormPackageSpool(storage);
    spool.beginLaunch("launch_session_000001");
    storage.setItem.mockImplementationOnce(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => spool.appendCheckpoint(checkpoint())).toThrow(
      expect.objectContaining<Partial<OfflineScormPackagePrototypeError>>({
        code: "storage_failed",
      }),
    );
    expect(spool.listEntries()).toEqual([]);
  });

  it("publishes a package only after every file passes its digest", async () => {
    const files: Record<string, { body: string; contentType: string }> = {
      "/index.html": {
        body: "<h1>Rise fixture</h1>",
        contentType: "text/html",
      },
      "/runtime.js": {
        body: "window.fixtureLoaded = true;",
        contentType: "text/javascript",
      },
    };
    const manifest = packageManifest(files);
    const caches = new MemoryCacheStorage();
    const packageFetch = vi.fn(
      (request: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        void init;
        const url = new URL(
          request instanceof Request ? request.url : request.toString(),
        );
        const file = files[url.pathname];
        return Promise.resolve(
          file
            ? new Response(file.body, {
                headers: { "Content-Type": file.contentType },
              })
            : new Response("missing", { status: 404 }),
        );
      },
    );

    const installed = await installOfflineScormPackage({
      manifest,
      applicationOrigin: "https://app.upskill.example",
      learningOrigin: "https://learn.upskill.example",
      caches: caches as unknown as Pick<
        CacheStorage,
        "delete" | "match" | "open"
      >,
      fetch: packageFetch,
      subtle: crypto.subtle,
      randomUUID: () => "staging-id",
    });
    expect(installed.status).toBe("ready");
    expect([...caches.stores.keys()]).toEqual([installed.cacheName]);
    const installedEntrypoint = await matchInstalledOfflineScormPackage({
      manifest,
      applicationOrigin: "https://app.upskill.example",
      caches: caches as unknown as Pick<CacheStorage, "open">,
      request: new Request(`${manifest.packageOrigin}/index.html`),
      subtle: crypto.subtle,
    });
    expect(installedEntrypoint?.headers.get("content-security-policy")).toBe(
      "base-uri 'none'; connect-src 'self'; default-src 'self'; font-src 'self' data:; form-action 'none'; frame-ancestors 'self' https://app.upskill.example; frame-src 'self' https://embed.articulateusercontent.com; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; worker-src 'self' blob:",
    );
    await expect(
      matchInstalledOfflineScormPackage({
        manifest,
        applicationOrigin: "https://app.upskill.example",
        caches: caches as unknown as Pick<CacheStorage, "open">,
        request: new Request(`${manifest.packageOrigin}/index.html`),
        subtle: crypto.subtle,
      }).then((response) => response?.text()),
    ).resolves.toBe("<h1>Rise fixture</h1>");
    expect(packageFetch).toHaveBeenCalledTimes(2);
    for (const [request, init] of packageFetch.mock.calls) {
      expect(request).toBeInstanceOf(Request);
      expect((request as Request).credentials).toBe("omit");
      expect(init).toMatchObject({ credentials: "omit", cache: "no-store" });
    }
  });

  it("rebuilds trusted headers and fails closed on replaced package bytes", async () => {
    const files = {
      "/index.html": { body: "ready", contentType: "text/html" },
    };
    const manifest = packageManifest(files);
    const caches = new MemoryCacheStorage();
    const installed = await installOfflineScormPackage({
      manifest,
      applicationOrigin: "https://app.upskill.example",
      learningOrigin: "https://learn.upskill.example",
      caches: caches as unknown as Pick<
        CacheStorage,
        "delete" | "match" | "open"
      >,
      fetch: vi.fn(() => Promise.resolve(new Response("ready"))),
      subtle: crypto.subtle,
      randomUUID: () => "staging-id",
    });
    const readyCache = caches.stores.get(installed.cacheName);
    if (!readyCache) throw new Error("Ready cache was not published");
    await readyCache.put(
      `${manifest.packageOrigin}/index.html`,
      new Response("ready", {
        headers: {
          "Cache-Control": "public, max-age=31536000",
          "Content-Security-Policy": "default-src *",
          "Content-Type": "text/plain",
          "Cross-Origin-Resource-Policy": "cross-origin",
          "Referrer-Policy": "unsafe-url",
          "X-Content-Type-Options": "attacker-controlled",
        },
      }),
    );

    const verifiedResponse = await matchInstalledOfflineScormPackage({
      manifest,
      applicationOrigin: "https://app.upskill.example",
      caches: caches as unknown as Pick<CacheStorage, "open">,
      request: new Request(`${manifest.packageOrigin}/index.html`),
      subtle: crypto.subtle,
    });

    await expect(verifiedResponse?.text()).resolves.toBe("ready");
    expect(Object.fromEntries(verifiedResponse?.headers ?? [])).toEqual({
      "cache-control": "no-store",
      "content-security-policy":
        "base-uri 'none'; connect-src 'self'; default-src 'self'; font-src 'self' data:; form-action 'none'; frame-ancestors 'self' https://app.upskill.example; frame-src 'self' https://embed.articulateusercontent.com; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; worker-src 'self' blob:",
      "content-type": "text/html",
      "cross-origin-resource-policy": "same-origin",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });

    const readyKey = [...readyCache.values.keys()].find((key) =>
      key.includes("/.__upskill_offline__/ready/"),
    );
    if (!readyKey) throw new Error("Ready marker was not published");
    expect(readyCache.values.delete(readyKey)).toBe(true);
    const missingReadyResponse = await matchInstalledOfflineScormPackage({
      manifest,
      applicationOrigin: "https://app.upskill.example",
      caches: caches as unknown as Pick<CacheStorage, "open">,
      request: new Request(`${manifest.packageOrigin}/index.html`),
      subtle: crypto.subtle,
    });
    expect(missingReadyResponse?.type).toBe("error");
    await readyCache.put(readyKey, new Response("ready"));

    await readyCache.put(
      `${manifest.packageOrigin}/index.html`,
      new Response("rogue"),
    );

    const response = await matchInstalledOfflineScormPackage({
      manifest,
      applicationOrigin: "https://app.upskill.example",
      caches: caches as unknown as Pick<CacheStorage, "open">,
      request: new Request(`${manifest.packageOrigin}/index.html`),
      subtle: crypto.subtle,
    });

    expect(response?.type).toBe("error");
    expect(response?.status).toBe(0);
  });

  it("reuses an immutable ready cache without risking its contents", async () => {
    const files = {
      "/index.html": { body: "ready", contentType: "text/html" },
    };
    const manifest = packageManifest(files);
    const caches = new MemoryCacheStorage();
    const firstFetch = vi.fn(() => Promise.resolve(new Response("ready")));
    const installInput = {
      manifest,
      applicationOrigin: "https://app.upskill.example",
      learningOrigin: "https://learn.upskill.example",
      caches: caches as unknown as Pick<
        CacheStorage,
        "delete" | "match" | "open"
      >,
      subtle: crypto.subtle,
      randomUUID: () => "first-staging-id",
    };
    const installed = await installOfflineScormPackage({
      ...installInput,
      fetch: firstFetch,
    });
    const readyCache = caches.stores.get(installed.cacheName);
    const beforeReinstall = await readyCache?.match(
      `${manifest.packageOrigin}/index.html`,
    );
    const reinstallFetch = vi.fn(() => Promise.reject(new Error("offline")));

    await expect(
      installOfflineScormPackage({
        ...installInput,
        fetch: reinstallFetch,
        randomUUID: () => "second-staging-id",
      }),
    ).resolves.toEqual(installed);
    expect(reinstallFetch).not.toHaveBeenCalled();
    await expect(beforeReinstall?.text()).resolves.toBe("ready");
    await expect(
      readyCache
        ?.match(`${manifest.packageOrigin}/index.html`)
        .then((response) => response?.text()),
    ).resolves.toBe("ready");
    expect([...caches.stores.keys()]).toEqual([installed.cacheName]);
  });

  it("repairs missing and replaced inventory behind a stale ready marker", async () => {
    const files: Record<string, { body: string; contentType: string }> = {
      "/index.html": { body: "ready", contentType: "text/html" },
      "/runtime.js": {
        body: "window.ready=true",
        contentType: "text/javascript",
      },
    };
    const manifest = packageManifest(files);
    const caches = new MemoryCacheStorage();
    const packageFetch = vi.fn((request: RequestInfo | URL) => {
      const url = new URL(
        request instanceof Request ? request.url : request.toString(),
      );
      const file = files[url.pathname];
      return Promise.resolve(
        file
          ? new Response(file.body, {
              headers: { "Content-Type": file.contentType },
            })
          : new Response("missing", { status: 404 }),
      );
    });
    const installInput = {
      manifest,
      applicationOrigin: "https://app.upskill.example",
      learningOrigin: "https://learn.upskill.example",
      caches: caches as unknown as Pick<
        CacheStorage,
        "delete" | "match" | "open"
      >,
      fetch: packageFetch,
      subtle: crypto.subtle,
    };
    const installed = await installOfflineScormPackage({
      ...installInput,
      randomUUID: () => "first-staging-id",
    });
    const readyCache = caches.stores.get(installed.cacheName);
    if (!readyCache) throw new Error("Ready cache was not published");
    expect(
      readyCache.values.delete(`${manifest.packageOrigin}/runtime.js`),
    ).toBe(true);
    await readyCache.put(
      `${manifest.packageOrigin}/index.html`,
      new Response("rogue"),
    );
    packageFetch.mockClear();

    await expect(
      installOfflineScormPackage({
        ...installInput,
        randomUUID: () => "repair-staging-id",
      }),
    ).resolves.toEqual(installed);

    expect(packageFetch).toHaveBeenCalledTimes(2);
    await expect(
      readyCache
        .match(`${manifest.packageOrigin}/index.html`)
        .then((response) => response?.text()),
    ).resolves.toBe("ready");
    await expect(
      readyCache
        .match(`${manifest.packageOrigin}/runtime.js`)
        .then((response) => response?.text()),
    ).resolves.toBe("window.ready=true");
    expect([...caches.stores.keys()]).toEqual([installed.cacheName]);
  });

  it("rejects manifest paths that normalize to another cache key", async () => {
    const files = {
      "/index.html": { body: "ready", contentType: "text/html" },
      "/%2e/index.html": { body: "alias", contentType: "text/html" },
    };
    const manifest = packageManifest(files);
    const caches = new MemoryCacheStorage();
    const packageFetch = vi.fn(() => Promise.resolve(new Response("ready")));
    const input = {
      applicationOrigin: "https://app.upskill.example",
      learningOrigin: "https://learn.upskill.example",
      caches: caches as unknown as Pick<
        CacheStorage,
        "delete" | "match" | "open"
      >,
      fetch: packageFetch,
      subtle: crypto.subtle,
      randomUUID: () => "staging-id",
    };

    await expect(
      installOfflineScormPackage({ manifest, ...input }),
    ).rejects.toThrow("canonical URL pathname");
    await expect(
      installOfflineScormPackage({
        manifest: {
          ...manifest,
          files: manifest.files.slice(0, 1),
          entrypointPath: "/%2e/index.html",
        },
        ...input,
      }),
    ).rejects.toThrow("canonical URL pathname");
    expect(packageFetch).not.toHaveBeenCalled();
    expect(caches.stores.size).toBe(0);
  });

  it("does not let a failed concurrent publisher delete a ready cache", async () => {
    const files = {
      "/index.html": { body: "ready", contentType: "text/html" },
    };
    const manifest = packageManifest(files);
    const caches = new MemoryCacheStorage();
    const finalCacheName = `upskill-offline-scorm-package-v1-${manifest.packageVersionId}-${manifest.packageSha256}`;
    const finalCache = await caches.open(finalCacheName);
    let rejectFirstPut: ((error: Error) => void) | undefined;
    let signalFirstPut: (() => void) | undefined;
    const firstPutStarted = new Promise<void>((resolve) => {
      signalFirstPut = resolve;
    });
    const firstPutFailure = new Promise<never>((_resolve, reject) => {
      rejectFirstPut = reject;
    });
    let putCount = 0;
    finalCache.putHook = async (_key, _response, commit) => {
      putCount += 1;
      if (putCount === 1) {
        signalFirstPut?.();
        await firstPutFailure;
      }
      commit();
    };
    const packageFetch = vi.fn(
      (request: RequestInfo | URL, init?: RequestInit) => {
        void request;
        void init;
        return Promise.resolve(new Response("ready"));
      },
    );
    const installInput = {
      manifest,
      applicationOrigin: "https://app.upskill.example",
      learningOrigin: "https://learn.upskill.example",
      caches: caches as unknown as Pick<
        CacheStorage,
        "delete" | "match" | "open"
      >,
      fetch: packageFetch,
      subtle: crypto.subtle,
    };

    const failingInstall = installOfflineScormPackage({
      ...installInput,
      randomUUID: () => "failing-staging-id",
    });
    await firstPutStarted;
    await expect(
      installOfflineScormPackage({
        ...installInput,
        randomUUID: () => "successful-staging-id",
      }),
    ).resolves.toEqual({ cacheName: finalCacheName, status: "ready" });
    rejectFirstPut?.(new Error("quota"));
    await expect(failingInstall).rejects.toMatchObject({
      code: "cache_failed",
    });
    await expect(
      matchInstalledOfflineScormPackage({
        manifest,
        applicationOrigin: "https://app.upskill.example",
        caches: caches as unknown as Pick<CacheStorage, "open">,
        request: new Request(`${manifest.packageOrigin}/index.html`),
        subtle: crypto.subtle,
      }).then((response) => response?.text()),
    ).resolves.toBe("ready");
    expect([...caches.stores.keys()]).toEqual([finalCacheName]);
  });

  it("deletes partial publication when a package digest is wrong", async () => {
    const manifest = packageManifest({
      "/index.html": { body: "expected", contentType: "text/html" },
    });
    const caches = new MemoryCacheStorage();
    await expect(
      installOfflineScormPackage({
        manifest,
        applicationOrigin: "https://app.upskill.example",
        learningOrigin: "https://learn.upskill.example",
        caches: caches as unknown as Pick<
          CacheStorage,
          "delete" | "match" | "open"
        >,
        fetch: vi.fn(() => Promise.resolve(new Response("tampered"))),
        subtle: crypto.subtle,
        randomUUID: () => "staging-id",
      }),
    ).rejects.toMatchObject({ code: "digest_mismatch" });
    expect(caches.stores.size).toBe(0);
  });

  it("refuses package installation on a credentialed sibling site", async () => {
    const manifest = packageManifest({
      "/index.html": { body: "expected", contentType: "text/html" },
    });
    const packageFetch = vi.fn(() => Promise.resolve(new Response("expected")));
    await expect(
      installOfflineScormPackage({
        manifest: {
          ...manifest,
          packageOrigin: "https://package.upskill.example",
        },
        applicationOrigin: "https://app.upskill.example",
        learningOrigin: "https://learn.upskill.example",
        caches: new MemoryCacheStorage() as unknown as Pick<
          CacheStorage,
          "delete" | "match" | "open"
        >,
        fetch: packageFetch,
        subtle: crypto.subtle,
        randomUUID: () => "staging-id",
      }),
    ).rejects.toMatchObject({ code: "invalid_origin" });
    expect(packageFetch).not.toHaveBeenCalled();
  });

  it("holds one browser-enforced lock for the exact package site", async () => {
    const request = vi.fn(
      async (
        name: string,
        options: LockOptions,
        callback: (lock: Lock | null) => Promise<unknown>,
      ) => {
        expect(name).toBe(OFFLINE_SCORM_PACKAGE_LOCK_NAME);
        expect(options).toMatchObject({ ifAvailable: true, mode: "exclusive" });
        return await callback({ name, mode: "exclusive" });
      },
    );
    await expect(
      holdOfflineScormPackageLock({ request } as unknown as LockManager, () =>
        Promise.resolve("closed"),
      ),
    ).resolves.toEqual({ status: "acquired", value: "closed" });

    request.mockImplementationOnce(
      async (_name, _options, callback) => await callback(null),
    );
    await expect(
      holdOfflineScormPackageLock({ request } as unknown as LockManager, () =>
        Promise.resolve("not-run"),
      ),
    ).resolves.toEqual({ status: "busy" });
  });

  it("binds direct sibling windows only after exact source and origin checks", () => {
    const learningPostMessage = vi.fn();
    const packagePostMessage = vi.fn();
    const learningWindow = {
      postMessage: learningPostMessage,
    } as unknown as Window;
    const packageWindow = {
      postMessage: packagePostMessage,
    } as unknown as Window;
    const port1 = {} as MessagePort;
    const port2 = {} as MessagePort;
    const learningReadyEvent = {
      data: {
        type: "offline-scorm-sibling-ready",
        protocolVersion: 1,
        role: "learning",
      },
      origin: "https://learn.upskill.example",
      source: learningWindow,
    } as const;
    const packageReadyEvent = {
      data: {
        type: "offline-scorm-sibling-ready",
        protocolVersion: 1,
        role: "package",
      },
      origin: "https://attempt-package.example.net",
      source: packageWindow,
    } as const;

    expect(
      isExpectedOfflineScormSiblingReady({
        event: {
          data: {
            type: "offline-scorm-sibling-ready",
            protocolVersion: 1,
            role: "package",
          },
          origin: "https://attempt-package.example.net",
          source: packageWindow,
        },
        expectedOrigin: "https://attempt-package.example.net",
        expectedSource: packageWindow,
        expectedRole: "package",
      }),
    ).toBe(true);
    expect(
      isExpectedOfflineScormSiblingReady({
        event: {
          data: {
            type: "offline-scorm-sibling-ready",
            protocolVersion: 1,
            role: "package",
          },
          origin: "https://attempt-package.example.net",
          source: learningWindow,
        },
        expectedOrigin: "https://attempt-package.example.net",
        expectedSource: packageWindow,
        expectedRole: "package",
      }),
    ).toBe(false);

    bindOfflineScormSiblingChannel({
      applicationOrigin: "https://app.upskill.example",
      learningOrigin: "https://learn.upskill.example",
      packageOrigin: "https://attempt-package.example.net",
      learningWindow,
      packageWindow,
      learningReadyEvent,
      packageReadyEvent,
      createChannel: () => ({ port1, port2 }),
    });
    expect(learningPostMessage).toHaveBeenCalledWith(
      {
        type: "offline-scorm-sibling-channel",
        protocolVersion: 1,
      },
      "https://learn.upskill.example",
      [port1],
    );
    expect(packagePostMessage).toHaveBeenCalledWith(
      {
        type: "offline-scorm-sibling-channel",
        protocolVersion: 1,
      },
      "https://attempt-package.example.net",
      [port2],
    );
    expect(() => {
      bindOfflineScormSiblingChannel({
        applicationOrigin: "https://app.upskill.example",
        learningOrigin: "https://learn.upskill.example",
        packageOrigin: "https://attempt-package.example.net",
        learningWindow,
        packageWindow,
        learningReadyEvent,
        packageReadyEvent: {
          ...packageReadyEvent,
          source: learningWindow,
        },
        createChannel: () => ({ port1, port2 }),
      });
    }).toThrow(
      expect.objectContaining<Partial<OfflineScormPackagePrototypeError>>({
        code: "channel_rejected",
      }),
    );
  });

  it("requires Safari-style storage access to pass a real round trip", async () => {
    const values = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => {
      values.set(key, value);
    });
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem,
    } as Pick<Storage, "getItem" | "removeItem" | "setItem">;
    const requestStorageAccess = vi.fn(() => Promise.resolve());
    await expect(
      requestOfflineScormPackageStorageAccess({
        document: {},
        storage,
        randomUUID: () => "ordinary-probe",
      }),
    ).resolves.toBe("not_required");
    expect(values.size).toBe(0);
    await expect(
      requestOfflineScormPackageStorageAccess({
        document: {
          hasStorageAccess: () => Promise.resolve(false),
          requestStorageAccess,
        },
        storage,
        randomUUID: () => "probe",
      }),
    ).resolves.toBe("granted");
    expect(requestStorageAccess).toHaveBeenCalledOnce();
    expect(values.size).toBe(0);
    expect(setItem.mock.calls.map(([, value]) => value)).toEqual([
      "upskill-offline-storage-probe-ordinary-probe-initial",
      "upskill-offline-storage-probe-ordinary-probe-replacement",
      "upskill-offline-storage-probe-probe-initial",
      "upskill-offline-storage-probe-probe-replacement",
    ]);

    const replaceBlockedValues = new Map<string, string>();
    await expect(
      requestOfflineScormPackageStorageAccess({
        document: {},
        storage: {
          getItem: (key) => replaceBlockedValues.get(key) ?? null,
          removeItem: (key) => {
            replaceBlockedValues.delete(key);
          },
          setItem: (key, value) => {
            if (!replaceBlockedValues.has(key))
              replaceBlockedValues.set(key, value);
          },
        },
        randomUUID: () => "replace-blocked-probe",
      }),
    ).rejects.toMatchObject({ code: "storage_access_denied" });
    expect(replaceBlockedValues.size).toBe(0);

    await expect(
      requestOfflineScormPackageStorageAccess({
        document: {
          hasStorageAccess: () => Promise.resolve(false),
          requestStorageAccess: () =>
            Promise.reject(new DOMException("denied", "NotAllowedError")),
        },
        storage,
        randomUUID: () => "probe",
      }),
    ).rejects.toMatchObject({ code: "storage_access_denied" });
  });

  it("clears the dedicated package site as one authoritative operation", async () => {
    let registrations = [
      { unregister: vi.fn(() => Promise.resolve(true)) },
    ] as unknown as ServiceWorkerRegistration[];
    let caches = ["package", "vendor"];
    let cookies = [{ name: "vendor" }];
    const localStorage = { clear: vi.fn(), getItem: vi.fn(() => null) };
    const sessionStorage = { clear: vi.fn() };
    const cookieDelete = vi.fn((name: string) => {
      cookies = cookies.filter((cookie) => cookie.name !== name);
      return Promise.resolve();
    });
    const clearSiteData = vi.fn(() => Promise.resolve());

    await cleanupOfflineScormPackageSite({
      clearSiteData,
      caches: {
        keys: () => Promise.resolve(caches),
        delete: (name) => {
          caches = caches.filter((candidate) => candidate !== name);
          return Promise.resolve(true);
        },
      },
      indexedDB: {
        databases: () => Promise.resolve([]),
        deleteDatabase: vi.fn(),
      },
      localStorage,
      sessionStorage,
      serviceWorker: {
        getRegistrations: () => {
          const current = registrations;
          registrations = [];
          return Promise.resolve(current);
        },
      },
      cookieStore: {
        getAll: () => Promise.resolve(cookies),
        delete: cookieDelete,
      },
    });

    expect(localStorage.clear).toHaveBeenCalledOnce();
    expect(clearSiteData).toHaveBeenCalledOnce();
    expect(sessionStorage.clear).toHaveBeenCalledOnce();
    expect(cookieDelete).toHaveBeenCalledWith("vendor");
    expect(caches).toEqual([]);
  });

  it("refuses package-site cleanup while checkpoints await import", async () => {
    const storage = new MemoryStorage();
    const spool = new OfflineScormPackageSpool(storage);
    spool.beginLaunch("launch_session_000001");
    spool.appendCheckpoint(checkpoint());
    const clearSiteData = vi.fn(() => Promise.resolve());
    const clearLocalStorage = vi.fn(() => {
      storage.values.clear();
    });

    await expect(
      cleanupOfflineScormPackageSite({
        clearSiteData,
        caches: {
          keys: () => Promise.resolve([]),
          delete: vi.fn(() => Promise.resolve(true)),
        },
        indexedDB: {
          databases: () => Promise.resolve([]),
          deleteDatabase: vi.fn(),
        },
        localStorage: {
          clear: clearLocalStorage,
          getItem: storage.getItem,
        },
        sessionStorage: { clear: vi.fn() },
        serviceWorker: { getRegistrations: () => Promise.resolve([]) },
        cookieStore: {
          getAll: () => Promise.resolve([]),
          delete: vi.fn(() => Promise.resolve()),
        },
      }),
    ).rejects.toMatchObject({ code: "cleanup_failed" });

    expect(clearSiteData).not.toHaveBeenCalled();
    expect(clearLocalStorage).not.toHaveBeenCalled();
    expect(spool.listEntries()).toHaveLength(1);
  });

  it("refuses cleanup when stored spool data exceeds its byte ceiling", async () => {
    const serialized = `${JSON.stringify({
      schemaVersion: 1,
      nextOrdinal: 1,
      activeLaunch: null,
      entries: [],
    })}${" ".repeat(512 * 1024)}`;
    const clearSiteData = vi.fn(() => Promise.resolve());
    const clearLocalStorage = vi.fn();

    await expect(
      cleanupOfflineScormPackageSite({
        clearSiteData,
        caches: {
          keys: () => Promise.resolve([]),
          delete: vi.fn(() => Promise.resolve(true)),
        },
        indexedDB: {
          databases: () => Promise.resolve([]),
          deleteDatabase: vi.fn(),
        },
        localStorage: {
          clear: clearLocalStorage,
          getItem: vi.fn(() => serialized),
        },
        sessionStorage: { clear: vi.fn() },
        serviceWorker: { getRegistrations: () => Promise.resolve([]) },
        cookieStore: {
          getAll: () => Promise.resolve([]),
          delete: vi.fn(() => Promise.resolve()),
        },
      }),
    ).rejects.toMatchObject({ code: "cleanup_failed" });

    expect(clearSiteData).not.toHaveBeenCalled();
    expect(clearLocalStorage).not.toHaveBeenCalled();
  });
});
