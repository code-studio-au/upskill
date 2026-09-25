import { getDomain } from "tldts";
import { buildLearningContentSecurityPolicy } from "#/features/scorm/learning-content-security-policy";
import {
  offlineScormSpoolEntrySchema,
  type OfflineScormSpoolEntry,
} from "#/features/scorm/offline-scorm-trusted-runtime";
import { z } from "#/validation/zod";

const OFFLINE_SCORM_PACKAGE_PROTOCOL_VERSION = 1;
const OFFLINE_SCORM_PACKAGE_CACHE_PREFIX = "upskill-offline-scorm-package-v1-";
export const OFFLINE_SCORM_PACKAGE_LOCK_NAME =
  "upskill-offline-scorm-exact-attempt-v1";
const OFFLINE_SCORM_PACKAGE_SPOOL_KEY = "upskill-offline-scorm-spool-v1";
const OFFLINE_SCORM_PACKAGE_SPOOL_RECORD_LIMIT = 64;
const OFFLINE_SCORM_PACKAGE_SPOOL_BYTE_LIMIT = 512 * 1024;
const OFFLINE_SCORM_PACKAGE_FILE_LIMIT = 5_000;
const OFFLINE_SCORM_PACKAGE_FILE_BYTE_LIMIT = 64 * 1024 * 1024;
const OFFLINE_SCORM_PACKAGE_EXPANDED_BYTE_LIMIT = 1024 * 1024 * 1024;

const internalIdSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_-]+$/u),
  );
const runtimeVersionSchema = z
  .string()
  .check(
    z.minLength(1),
    z.maxLength(100),
    z.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
  );
const randomIdSchema = z
  .string()
  .check(z.minLength(16), z.maxLength(200), z.regex(/^[A-Za-z0-9_-]+$/u));
const sha256Schema = z.string().check(z.regex(/^[a-f0-9]{64}$/u));
const packagePathnameSchema = z
  .string()
  .check(
    z.minLength(2),
    z.maxLength(2_048),
    z.regex(/^\/(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^?#\\]*$/u),
  );

const offlineScormPackageFileSchema = z.strictObject({
  pathname: packagePathnameSchema,
  sha256: sha256Schema,
  sizeBytes: z
    .number()
    .check(
      z.int(),
      z.nonnegative(),
      z.maximum(OFFLINE_SCORM_PACKAGE_FILE_BYTE_LIMIT),
    ),
  contentType: z
    .string()
    .check(z.minLength(1), z.maxLength(255), z.regex(/^[\u0020-\u007e]+$/u)),
});

const offlineScormPackageManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    packageVersionId: internalIdSchema,
    packageSha256: sha256Schema,
    runtimeVersion: runtimeVersionSchema,
    packageOrigin: z.url(),
    entrypointPath: packagePathnameSchema,
    files: z
      .array(offlineScormPackageFileSchema)
      .check(z.minLength(1), z.maxLength(OFFLINE_SCORM_PACKAGE_FILE_LIMIT)),
  })
  .check(
    z.superRefine((manifest, context) => {
      let packageOrigin: URL;
      try {
        packageOrigin = exactOrigin(manifest.packageOrigin);
      } catch {
        context.addIssue({
          code: "custom",
          path: ["packageOrigin"],
          message: "The package origin must contain only an exact origin",
        });
        return;
      }
      if (!isPotentiallyTrustworthyPackageOrigin(packageOrigin))
        context.addIssue({
          code: "custom",
          path: ["packageOrigin"],
          message: "The package origin must use HTTPS outside loopback",
        });
      const pathnames = new Set<string>();
      for (const [index, file] of manifest.files.entries()) {
        const canonicalPathname = new URL(file.pathname, packageOrigin)
          .pathname;
        if (canonicalPathname !== file.pathname)
          context.addIssue({
            code: "custom",
            path: ["files", index, "pathname"],
            message: "Package file paths must use their canonical URL pathname",
          });
        if (pathnames.has(canonicalPathname))
          context.addIssue({
            code: "custom",
            path: ["files", index, "pathname"],
            message: "Package file paths must resolve to unique cache keys",
          });
        pathnames.add(canonicalPathname);
      }
      if (
        manifest.files.reduce((total, file) => total + file.sizeBytes, 0) >
        OFFLINE_SCORM_PACKAGE_EXPANDED_BYTE_LIMIT
      )
        context.addIssue({
          code: "custom",
          path: ["files"],
          message: "The expanded package exceeds the supported size limit",
        });
      const canonicalEntrypointPath = new URL(
        manifest.entrypointPath,
        packageOrigin,
      ).pathname;
      if (canonicalEntrypointPath !== manifest.entrypointPath)
        context.addIssue({
          code: "custom",
          path: ["entrypointPath"],
          message: "The entrypoint must use its canonical URL pathname",
        });
      if (!pathnames.has(canonicalEntrypointPath))
        context.addIssue({
          code: "custom",
          path: ["entrypointPath"],
          message: "The entrypoint must be present in the file inventory",
        });
    }),
  );

const offlineScormPackageSpoolStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  nextOrdinal: z
    .number()
    .check(z.int(), z.minimum(1), z.maximum(2_147_483_647)),
  activeLaunch: z.nullable(
    z.strictObject({
      launchSessionId: randomIdSchema,
      elapsedHighwaterSeconds: z
        .number()
        .check(z.int(), z.nonnegative(), z.maximum(31_536_000)),
    }),
  ),
  entries: z
    .array(offlineScormSpoolEntrySchema)
    .check(z.maxLength(OFFLINE_SCORM_PACKAGE_SPOOL_RECORD_LIMIT)),
});

const offlineScormSiblingReadyMessageSchema = z.strictObject({
  type: z.literal("offline-scorm-sibling-ready"),
  protocolVersion: z.literal(OFFLINE_SCORM_PACKAGE_PROTOCOL_VERSION),
  role: z.enum(["learning", "package"]),
});

const offlineScormSiblingChannelMessageSchema = z.strictObject({
  type: z.literal("offline-scorm-sibling-channel"),
  protocolVersion: z.literal(OFFLINE_SCORM_PACKAGE_PROTOCOL_VERSION),
});

export type OfflineScormPackageManifest = z.infer<
  typeof offlineScormPackageManifestSchema
>;

export class OfflineScormPackagePrototypeError extends Error {
  constructor(
    public readonly code:
      | "cache_failed"
      | "channel_rejected"
      | "cleanup_failed"
      | "digest_mismatch"
      | "invalid_origin"
      | "package_unavailable"
      | "spool_corrupt"
      | "spool_full"
      | "storage_access_denied"
      | "storage_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OfflineScormPackagePrototypeError";
  }
}

function exactOrigin(value: string): URL {
  const url = new URL(value);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new TypeError("Expected an exact origin");
  return url;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  );
}

function isPotentiallyTrustworthyPackageOrigin(origin: URL): boolean {
  return origin.protocol === "https:" || isLoopbackHostname(origin.hostname);
}

function schemefulSite(origin: URL): string {
  const domain = getDomain(origin.hostname, {
    allowPrivateDomains: true,
    detectIp: true,
    validateHostname: true,
  });
  return `${origin.protocol}//${domain ?? origin.hostname}`;
}

export function assertOfflineScormPackageSiteIsolation(input: {
  applicationOrigin: string;
  learningOrigin: string;
  packageOrigin: string;
}): void {
  let applicationOrigin: URL;
  let learningOrigin: URL;
  let packageOrigin: URL;
  try {
    applicationOrigin = exactOrigin(input.applicationOrigin);
    learningOrigin = exactOrigin(input.learningOrigin);
    packageOrigin = exactOrigin(input.packageOrigin);
  } catch (error) {
    throw new OfflineScormPackagePrototypeError(
      "invalid_origin",
      "Offline SCORM origins must be exact origins",
      { cause: error },
    );
  }
  if (!isPotentiallyTrustworthyPackageOrigin(packageOrigin))
    throw new OfflineScormPackagePrototypeError(
      "invalid_origin",
      "The package origin must use HTTPS outside loopback",
    );
  const packageSite = schemefulSite(packageOrigin);
  if (
    packageOrigin.origin === applicationOrigin.origin ||
    packageOrigin.origin === learningOrigin.origin ||
    packageSite === schemefulSite(applicationOrigin) ||
    packageSite === schemefulSite(learningOrigin)
  )
    throw new OfflineScormPackagePrototypeError(
      "invalid_origin",
      "The package origin must use a distinct registrable site",
    );
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function emptySpoolState(): z.infer<
  typeof offlineScormPackageSpoolStateSchema
> {
  return {
    schemaVersion: 1,
    nextOrdinal: 1,
    activeLaunch: null,
    entries: [],
  };
}

function readOfflineScormPackageSpoolState(
  storage: Pick<Storage, "getItem">,
  options: { byteLimit?: number; storageKey?: string } = {},
): z.infer<typeof offlineScormPackageSpoolStateSchema> {
  let serialized: string | null;
  try {
    serialized = storage.getItem(
      options.storageKey ?? OFFLINE_SCORM_PACKAGE_SPOOL_KEY,
    );
  } catch (error) {
    throw new OfflineScormPackagePrototypeError(
      "storage_failed",
      "The package spool could not be read",
      { cause: error },
    );
  }
  if (serialized === null) return emptySpoolState();
  if (
    byteLength(serialized) >
    (options.byteLimit ?? OFFLINE_SCORM_PACKAGE_SPOOL_BYTE_LIMIT)
  )
    throw new OfflineScormPackagePrototypeError(
      "spool_corrupt",
      "The package spool exceeds its safe size limit",
    );
  try {
    return offlineScormPackageSpoolStateSchema.parse(JSON.parse(serialized));
  } catch (error) {
    throw new OfflineScormPackagePrototypeError(
      "spool_corrupt",
      "The package spool is not valid",
      { cause: error },
    );
  }
}

export class OfflineScormPackageSpool {
  constructor(
    private readonly storage: Pick<Storage, "getItem" | "setItem">,
    private readonly options: {
      byteLimit?: number;
      recordLimit?: number;
      storageKey?: string;
    } = {},
  ) {}

  private readState(): z.infer<typeof offlineScormPackageSpoolStateSchema> {
    return readOfflineScormPackageSpoolState(this.storage, this.options);
  }

  private writeState(
    state: z.infer<typeof offlineScormPackageSpoolStateSchema>,
  ): void {
    const validated = offlineScormPackageSpoolStateSchema.parse(state);
    const serialized = JSON.stringify(validated);
    if (
      validated.entries.length >
        (this.options.recordLimit ??
          OFFLINE_SCORM_PACKAGE_SPOOL_RECORD_LIMIT) ||
      byteLength(serialized) >
        (this.options.byteLimit ?? OFFLINE_SCORM_PACKAGE_SPOOL_BYTE_LIMIT)
    )
      throw new OfflineScormPackagePrototypeError(
        "spool_full",
        "The package spool has reached its safe limit",
      );
    try {
      this.storage.setItem(
        this.options.storageKey ?? OFFLINE_SCORM_PACKAGE_SPOOL_KEY,
        serialized,
      );
    } catch (error) {
      throw new OfflineScormPackagePrototypeError(
        "storage_failed",
        "The package spool could not be committed",
        { cause: error },
      );
    }
  }

  beginLaunch(launchSessionId: string): void {
    const parsedLaunchSessionId = randomIdSchema.parse(launchSessionId);
    const state = this.readState();
    if (state.activeLaunch?.launchSessionId === parsedLaunchSessionId) return;
    if (state.entries.length > 0)
      throw new OfflineScormPackagePrototypeError(
        "spool_corrupt",
        "The previous launch spool must be drained before another launch",
      );
    this.writeState({
      ...state,
      nextOrdinal: 1,
      activeLaunch: {
        launchSessionId: parsedLaunchSessionId,
        elapsedHighwaterSeconds: 0,
      },
    });
  }

  appendCheckpoint(
    input: Omit<
      OfflineScormSpoolEntry,
      "schemaVersion" | "ordinal" | "sessionTimeDeltaSeconds"
    >,
  ): OfflineScormSpoolEntry {
    const state = this.readState();
    const activeLaunch = state.activeLaunch;
    if (!activeLaunch || activeLaunch.launchSessionId !== input.launchSessionId)
      throw new OfflineScormPackagePrototypeError(
        "spool_corrupt",
        "The checkpoint does not match the active launch",
      );
    if (input.sessionElapsedSeconds < activeLaunch.elapsedHighwaterSeconds)
      throw new OfflineScormPackagePrototypeError(
        "spool_corrupt",
        "Session elapsed time cannot regress",
      );
    if (
      state.entries.some((entry) => entry.spoolEntryId === input.spoolEntryId)
    )
      throw new OfflineScormPackagePrototypeError(
        "spool_corrupt",
        "A spool entry identifier cannot be reused",
      );
    const entry = offlineScormSpoolEntrySchema.parse({
      ...input,
      schemaVersion: 1,
      ordinal: state.nextOrdinal,
      sessionTimeDeltaSeconds:
        input.sessionElapsedSeconds - activeLaunch.elapsedHighwaterSeconds,
    });
    this.writeState({
      schemaVersion: 1,
      nextOrdinal: state.nextOrdinal + 1,
      activeLaunch: {
        ...activeLaunch,
        elapsedHighwaterSeconds: input.sessionElapsedSeconds,
      },
      entries: [...state.entries, entry],
    });
    return entry;
  }

  listEntries(): OfflineScormSpoolEntry[] {
    return this.readState().entries.map((entry) => ({ ...entry }));
  }

  acknowledge(spoolEntryId: string): void {
    const parsedSpoolEntryId = randomIdSchema.parse(spoolEntryId);
    const state = this.readState();
    const index = state.entries.findIndex(
      (entry) => entry.spoolEntryId === parsedSpoolEntryId,
    );
    if (index < 0) return;
    this.writeState({
      ...state,
      entries: state.entries.filter((_, entryIndex) => entryIndex !== index),
    });
  }
}

export async function holdOfflineScormPackageLock<T>(
  locks: Pick<LockManager, "request">,
  work: () => Promise<T>,
): Promise<{ status: "acquired"; value: T } | { status: "busy" }> {
  return await locks.request(
    OFFLINE_SCORM_PACKAGE_LOCK_NAME,
    { ifAvailable: true, mode: "exclusive" },
    async (lock) =>
      lock
        ? { status: "acquired" as const, value: await work() }
        : { status: "busy" as const },
  );
}

function packageCacheName(manifest: OfflineScormPackageManifest): string {
  return `${OFFLINE_SCORM_PACKAGE_CACHE_PREFIX}${manifest.packageVersionId}-${manifest.packageSha256}`;
}

function packageReadyUrl(manifest: OfflineScormPackageManifest): string {
  return `${manifest.packageOrigin}/.__upskill_offline__/ready/${manifest.packageVersionId}/${manifest.packageSha256}`;
}

async function responseSha256(
  bytes: ArrayBuffer,
  subtle: Pick<SubtleCrypto, "digest">,
): Promise<string> {
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function packageFileRequest(
  manifest: OfflineScormPackageManifest,
  pathname: string,
): Request {
  return new Request(new URL(pathname, manifest.packageOrigin), {
    credentials: "omit",
    method: "GET",
    cache: "no-store",
  });
}

function trustedPackageFileResponse(
  bytes: ArrayBuffer,
  file: OfflineScormPackageManifest["files"][number],
  applicationOrigin: string,
): Response {
  return new Response(bytes, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        buildLearningContentSecurityPolicy(applicationOrigin),
      "Content-Type": file.contentType,
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
    status: 200,
  });
}

async function isOfflineScormPackageCacheReady(input: {
  cache: Pick<Cache, "match">;
  manifest: OfflineScormPackageManifest;
  subtle: Pick<SubtleCrypto, "digest">;
}): Promise<boolean> {
  if (!(await input.cache.match(packageReadyUrl(input.manifest)))) return false;
  try {
    for (const file of input.manifest.files) {
      const response = await input.cache.match(
        packageFileRequest(input.manifest, file.pathname),
      );
      if (!response) return false;
      const bytes = await response.arrayBuffer();
      if (
        bytes.byteLength !== file.sizeBytes ||
        (await responseSha256(bytes, input.subtle)) !== file.sha256
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function installOfflineScormPackage(input: {
  manifest: OfflineScormPackageManifest;
  applicationOrigin: string;
  learningOrigin: string;
  caches: Pick<CacheStorage, "delete" | "match" | "open">;
  fetch: typeof fetch;
  subtle: Pick<SubtleCrypto, "digest">;
  randomUUID: () => string;
}): Promise<{ cacheName: string; status: "ready" }> {
  const manifest = offlineScormPackageManifestSchema.parse(input.manifest);
  assertOfflineScormPackageSiteIsolation({
    applicationOrigin: input.applicationOrigin,
    learningOrigin: input.learningOrigin,
    packageOrigin: manifest.packageOrigin,
  });
  const finalCacheName = packageCacheName(manifest);
  const readyUrl = packageReadyUrl(manifest);
  if (await input.caches.match(readyUrl, { cacheName: finalCacheName })) {
    const finalCache = await input.caches.open(finalCacheName);
    if (
      await isOfflineScormPackageCacheReady({
        cache: finalCache,
        manifest,
        subtle: input.subtle,
      })
    )
      return { cacheName: finalCacheName, status: "ready" };
  }
  const temporaryCacheName = `${finalCacheName}-staging-${input.randomUUID()}`;
  try {
    const temporaryCache = await input.caches.open(temporaryCacheName);
    for (const file of manifest.files) {
      const request = packageFileRequest(manifest, file.pathname);
      const response = await input.fetch(request, {
        cache: "no-store",
        credentials: "omit",
      });
      if (!response.ok || response.type === "opaque")
        throw new OfflineScormPackagePrototypeError(
          "package_unavailable",
          "A package file could not be downloaded",
        );
      const bytes = await response.arrayBuffer();
      if (
        bytes.byteLength !== file.sizeBytes ||
        (await responseSha256(bytes, input.subtle)) !== file.sha256
      )
        throw new OfflineScormPackagePrototypeError(
          "digest_mismatch",
          "A package file failed its integrity check",
        );
      await temporaryCache.put(
        request,
        trustedPackageFileResponse(bytes, file, input.applicationOrigin),
      );
    }

    const finalCache = await input.caches.open(finalCacheName);
    if (
      await isOfflineScormPackageCacheReady({
        cache: finalCache,
        manifest,
        subtle: input.subtle,
      })
    ) {
      await input.caches.delete(temporaryCacheName);
      return { cacheName: finalCacheName, status: "ready" };
    }
    for (const file of manifest.files) {
      const request = packageFileRequest(manifest, file.pathname);
      const response = await temporaryCache.match(request);
      if (!response)
        throw new OfflineScormPackagePrototypeError(
          "cache_failed",
          "A verified package file disappeared before publication",
        );
      await finalCache.put(request, response);
    }
    await finalCache.put(
      readyUrl,
      new Response(JSON.stringify(manifest), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    if (
      !(await isOfflineScormPackageCacheReady({
        cache: finalCache,
        manifest,
        subtle: input.subtle,
      }))
    )
      throw new OfflineScormPackagePrototypeError(
        "cache_failed",
        "The published package cache failed its integrity check",
      );
    await input.caches.delete(temporaryCacheName);
    return { cacheName: finalCacheName, status: "ready" };
  } catch (error) {
    await input.caches.delete(temporaryCacheName).catch(() => false);
    if (error instanceof OfflineScormPackagePrototypeError) throw error;
    throw new OfflineScormPackagePrototypeError(
      "cache_failed",
      "The package cache could not be published",
      { cause: error },
    );
  }
}

export async function matchInstalledOfflineScormPackage(input: {
  manifest: OfflineScormPackageManifest;
  applicationOrigin: string;
  caches: Pick<CacheStorage, "open">;
  request: Request;
  subtle: Pick<SubtleCrypto, "digest">;
}): Promise<Response | null> {
  const manifest = offlineScormPackageManifestSchema.parse(input.manifest);
  const applicationOrigin = exactOrigin(input.applicationOrigin).origin;
  const requestUrl = new URL(input.request.url);
  if (
    input.request.method !== "GET" ||
    requestUrl.origin !== manifest.packageOrigin ||
    requestUrl.search !== "" ||
    requestUrl.hash !== ""
  )
    return null;
  const file = manifest.files.find(
    (candidate) => candidate.pathname === requestUrl.pathname,
  );
  if (!file) return null;
  const cache = await input.caches.open(packageCacheName(manifest));
  if (!(await cache.match(packageReadyUrl(manifest)))) return Response.error();
  const cached = await cache.match(
    packageFileRequest(manifest, requestUrl.pathname),
  );
  if (!cached) return Response.error();
  try {
    const bytes = await cached.arrayBuffer();
    if (
      bytes.byteLength !== file.sizeBytes ||
      (await responseSha256(bytes, input.subtle)) !== file.sha256
    )
      return Response.error();
    return trustedPackageFileResponse(bytes, file, applicationOrigin);
  } catch {
    return Response.error();
  }
}

export function isExpectedOfflineScormSiblingReady(input: {
  event: Pick<MessageEvent, "data" | "origin" | "source">;
  expectedOrigin: string;
  expectedSource: Window;
  expectedRole: "learning" | "package";
}): boolean {
  const message = offlineScormSiblingReadyMessageSchema.safeParse(
    input.event.data,
  );
  return (
    message.success &&
    input.event.origin === exactOrigin(input.expectedOrigin).origin &&
    input.event.source === input.expectedSource &&
    message.data.role === input.expectedRole
  );
}

export function bindOfflineScormSiblingChannel(input: {
  applicationOrigin: string;
  learningOrigin: string;
  packageOrigin: string;
  learningWindow: Window;
  packageWindow: Window;
  learningReadyEvent: Pick<MessageEvent, "data" | "origin" | "source">;
  packageReadyEvent: Pick<MessageEvent, "data" | "origin" | "source">;
  createChannel?: () => MessageChannel;
}): MessageChannel {
  assertOfflineScormPackageSiteIsolation(input);
  if (
    !isExpectedOfflineScormSiblingReady({
      event: input.learningReadyEvent,
      expectedOrigin: input.learningOrigin,
      expectedSource: input.learningWindow,
      expectedRole: "learning",
    }) ||
    !isExpectedOfflineScormSiblingReady({
      event: input.packageReadyEvent,
      expectedOrigin: input.packageOrigin,
      expectedSource: input.packageWindow,
      expectedRole: "package",
    })
  )
    throw new OfflineScormPackagePrototypeError(
      "channel_rejected",
      "The package sibling channel readiness proof was rejected",
    );
  const channel = input.createChannel?.() ?? new MessageChannel();
  const message = offlineScormSiblingChannelMessageSchema.parse({
    type: "offline-scorm-sibling-channel" as const,
    protocolVersion: OFFLINE_SCORM_PACKAGE_PROTOCOL_VERSION as 1,
  });
  try {
    input.learningWindow.postMessage(message, input.learningOrigin, [
      channel.port1,
    ]);
    input.packageWindow.postMessage(message, input.packageOrigin, [
      channel.port2,
    ]);
    return channel;
  } catch (error) {
    channel.port1.close();
    channel.port2.close();
    throw new OfflineScormPackagePrototypeError(
      "channel_rejected",
      "The package sibling channel could not be transferred",
      { cause: error },
    );
  }
}

interface OfflineScormStorageAccessDocument {
  hasStorageAccess?: () => Promise<boolean>;
  requestStorageAccess?: () => Promise<unknown>;
}

export async function requestOfflineScormPackageStorageAccess(input: {
  document: OfflineScormStorageAccessDocument;
  storage: Pick<Storage, "getItem" | "removeItem" | "setItem">;
  randomUUID: () => string;
}): Promise<"granted" | "not_required"> {
  const requiresStorageAccess = Boolean(input.document.requestStorageAccess);
  const key = `upskill-offline-storage-probe-${input.randomUUID()}`;
  const initialValue = `${key}-initial`;
  const replacementValue = `${key}-replacement`;
  try {
    if (
      input.document.requestStorageAccess &&
      !(await input.document.hasStorageAccess?.())
    )
      await input.document.requestStorageAccess();
    input.storage.setItem(key, initialValue);
    if (input.storage.getItem(key) !== initialValue)
      throw new Error("Storage write probe mismatch");
    input.storage.setItem(key, replacementValue);
    if (input.storage.getItem(key) !== replacementValue)
      throw new Error("Storage replace probe mismatch");
    input.storage.removeItem(key);
    if (input.storage.getItem(key) !== null)
      throw new Error("Storage delete probe mismatch");
    return requiresStorageAccess ? "granted" : "not_required";
  } catch (error) {
    try {
      input.storage.removeItem(key);
    } catch {
      // The failed capability probe already denies package-site storage.
    }
    throw new OfflineScormPackagePrototypeError(
      "storage_access_denied",
      "Package-site storage access was not confirmed",
      { cause: error },
    );
  }
}

interface OfflineScormCookieStore {
  getAll(): Promise<{ name: string }[]>;
  delete(name: string): Promise<void>;
}

interface OfflineScormCookieDocument {
  cookie: string;
}

function documentCookieNames(document: OfflineScormCookieDocument): string[] {
  return document.cookie
    .split(";")
    .map((cookie) => cookie.slice(0, Math.max(0, cookie.indexOf("="))).trim())
    .filter(Boolean);
}

async function deleteIndexedDatabase(
  factory: IDBFactory,
  name: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.addEventListener(
      "success",
      () => {
        resolve();
      },
      { once: true },
    );
    request.addEventListener(
      "blocked",
      () => {
        reject(new Error("IndexedDB deletion was blocked"));
      },
      { once: true },
    );
    request.addEventListener(
      "error",
      () => {
        reject(request.error ?? new Error("IndexedDB deletion failed"));
      },
      { once: true },
    );
  });
}

export async function cleanupOfflineScormPackageSite(input: {
  clearSiteData: () => Promise<void>;
  caches: Pick<CacheStorage, "delete" | "keys">;
  indexedDB: Pick<IDBFactory, "databases" | "deleteDatabase">;
  localStorage: Pick<Storage, "clear" | "getItem">;
  sessionStorage: Pick<Storage, "clear">;
  serviceWorker: Pick<ServiceWorkerContainer, "getRegistrations">;
  cookieStore?: OfflineScormCookieStore;
  cookieDocument?: OfflineScormCookieDocument;
}): Promise<void> {
  try {
    if (!input.cookieStore && !input.cookieDocument)
      throw new Error("A package-site cookie cleanup boundary is required");
    if (
      readOfflineScormPackageSpoolState(input.localStorage).entries.length > 0
    )
      throw new Error(
        "Pending package checkpoints must be imported before cleanup",
      );
    await input.clearSiteData();
    const databaseNames = (await input.indexedDB.databases()).flatMap(
      (database) => (database.name ? [database.name] : []),
    );
    const registrations = await input.serviceWorker.getRegistrations();
    const cacheNames = await input.caches.keys();
    const cookies = (await input.cookieStore?.getAll()) ?? [];
    const fallbackCookieNames = input.cookieDocument
      ? documentCookieNames(input.cookieDocument)
      : [];
    await Promise.all(
      registrations.map(async (registration) => {
        await registration.unregister();
      }),
    );
    await Promise.all([
      ...databaseNames.map((name) =>
        deleteIndexedDatabase(input.indexedDB as IDBFactory, name),
      ),
      ...cacheNames.map(async (name) => {
        await input.caches.delete(name);
      }),
      ...cookies.map((cookie) => input.cookieStore?.delete(cookie.name)),
    ]);
    if (input.cookieDocument)
      for (const name of fallbackCookieNames)
        input.cookieDocument.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Strict`;
    input.localStorage.clear();
    input.sessionStorage.clear();
    const [remainingDatabases, remainingRegistrations, remainingCaches] =
      await Promise.all([
        input.indexedDB.databases(),
        input.serviceWorker.getRegistrations(),
        input.caches.keys(),
      ]);
    if (
      remainingDatabases.some((database) => database.name) ||
      remainingRegistrations.length > 0 ||
      remainingCaches.length > 0
    )
      throw new Error("Package-site state remained after cleanup");
    if (input.cookieStore && (await input.cookieStore.getAll()).length > 0)
      throw new Error("Package-site cookies remained after cleanup");
    if (
      input.cookieDocument &&
      documentCookieNames(input.cookieDocument).length > 0
    )
      throw new Error("Package-site cookies remained after cleanup");
  } catch (error) {
    throw new OfflineScormPackagePrototypeError(
      "cleanup_failed",
      "The exact package site could not be cleared completely",
      { cause: error },
    );
  }
}
