import "@tanstack/react-start/server-only";

import { timingSafeEqual } from "node:crypto";
import { buildLearningContentSecurityPolicy } from "#/features/scorm/learning-content-security-policy";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv, type ServerEnv } from "#/server/env.server";
import {
  createOfflineScormPackageCleanupCapability,
  createOfflineScormPackageCleanupReceipt,
} from "#/server/scorm/offline-scorm-package-site.server";
import {
  offlineScormPackageHostHtml,
  readOfflineScormRuntimeAsset,
} from "#/server/scorm/offline-scorm-runtime-assets.server";
import {
  parseScormContentPath,
  parseScormRange,
  resolveScormContentType,
} from "#/server/scorm/scorm-content-path";
import {
  getObjectStream,
  type StoredObjectStream,
} from "#/server/storage/object-storage.server";
import { z } from "#/validation/zod.server";

const PACKAGE_HOST_LABEL = /^p-[a-f0-9]{56}$/u;
const packageManifestSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(1_024),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        sizeBytes: z.number().int().nonnegative(),
        contentType: z.string().min(1).max(255),
      }),
    )
    .min(1)
    .max(5_000),
});

interface AuthorizedPackage {
  contentPrefix: string;
  entitlementPackageSha256: string;
  manifest: unknown;
  packageSha256: string;
}

interface AuthorizedPackageRuntime {
  entitlementId: string;
  entitlementStatus: "active" | "resolved" | "replaced" | "hard_revoked";
  cleanupState: "pending" | "clearing" | "needs_attention" | "cleared";
  intendedLaunchExpiresAt: Date;
}

interface PackageHostConfiguration {
  applicationOrigin: string;
  environment: ServerEnv["APP_ENV"];
  learningOrigin: string;
  learningBucket: string;
  packageHostSuffix: string | undefined;
  packageSiteOriginKey?: string | undefined;
  enabled: boolean;
}

interface OfflineScormPackageHostDependencies {
  configuration: PackageHostConfiguration;
  findAuthorizedPackage: (
    packageOrigin: string,
    now: Date,
  ) => Promise<AuthorizedPackage | undefined>;
  findAuthorizedRuntime?: (
    packageOrigin: string,
  ) => Promise<AuthorizedPackageRuntime | undefined>;
  getObject: (
    bucket: string,
    key: string,
    range?: string,
  ) => Promise<StoredObjectStream>;
  readRuntimeAsset?: (assetName: string) => Promise<string>;
  now?: () => Date;
}

const PACKAGE_RUNTIME_PATHS = new Set([
  "/.__upskill_offline__/host.html",
  "/.__upskill_offline__/package-runtime.js",
  "/.__upskill_offline__/shared.js",
  "/.__upskill_offline__/worker.js",
]);
const PACKAGE_CLEAR_PATH = "/.__upskill_offline__/clear-site-data";

function objectErrorStatus(error: unknown): number {
  if (typeof error !== "object" || error === null || !("name" in error))
    return 500;
  if (error.name === "NoSuchKey" || error.name === "NotFound") return 404;
  if (
    error.name === "InvalidRange" ||
    error.name === "RequestedRangeNotSatisfiable"
  )
    return 416;
  return 500;
}

function packageHostHeaders(
  configuration: PackageHostConfiguration,
  cacheControl: string,
): Headers {
  const headers = new Headers({
    "Cache-Control": cacheControl,
    "Content-Security-Policy": buildLearningContentSecurityPolicy(
      new URL(configuration.applicationOrigin).origin,
    ),
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), display-capture=(), geolocation=(), microphone=(), payment=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  if (
    configuration.environment === "staging" ||
    configuration.environment === "production"
  )
    headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  return headers;
}

function requestedPackageOrigin(
  request: Request,
  configuration: PackageHostConfiguration,
  packageHostSuffix: string,
): { origin: string; validLabel: boolean } | undefined {
  const url = new URL(request.url);
  if (
    url.origin === new URL(configuration.applicationOrigin).origin ||
    url.origin === new URL(configuration.learningOrigin).origin
  )
    return undefined;
  const hostname = url.hostname.endsWith(".")
    ? url.hostname.slice(0, -1)
    : url.hostname;
  const suffix = `.${packageHostSuffix}`;
  if (!hostname.endsWith(suffix)) return undefined;
  const label = hostname.slice(0, -suffix.length);
  const localHttpOrigin =
    (configuration.environment === "development" ||
      configuration.environment === "test") &&
    packageHostSuffix === "localhost";
  const applicationUrl = new URL(configuration.applicationOrigin);
  return {
    origin: url.origin,
    validLabel:
      (localHttpOrigin
        ? url.protocol === "http:" && url.port === applicationUrl.port
        : url.protocol === "https:" && !url.port) &&
      !label.includes(".") &&
      PACKAGE_HOST_LABEL.test(label),
  };
}

async function findAuthorizedPackage(
  packageOrigin: string,
  now: Date,
): Promise<AuthorizedPackage | undefined> {
  return await getDatabase()
    .selectFrom("offline_scorm_cleanup_inventory as cleanup")
    .innerJoin(
      "offline_learning_entitlement as entitlement",
      "entitlement.id",
      "cleanup.entitlementId",
    )
    .innerJoin(
      "offline_learning_installation as installation",
      "installation.id",
      "entitlement.installationId",
    )
    .innerJoin(
      "scorm_attempt as attempt",
      "attempt.id",
      "entitlement.attemptId",
    )
    .innerJoin(
      "scorm_package_version as package",
      "package.id",
      "entitlement.scormPackageVersionId",
    )
    .select([
      "package.contentPrefix as contentPrefix",
      "package.manifest as manifest",
      "package.sha256 as packageSha256",
      "entitlement.packageSha256 as entitlementPackageSha256",
    ])
    .where("cleanup.packageSiteOrigin", "=", packageOrigin)
    .where("cleanup.state", "=", "pending")
    .where("entitlement.status", "=", "active")
    .where("entitlement.signedEnvelope", "is not", null)
    .where("entitlement.intendedLaunchExpiresAt", ">", now)
    .where("installation.status", "=", "active")
    .where("attempt.writerMode", "=", "offline")
    .whereRef("attempt.offlineEntitlementId", "=", "entitlement.id")
    .whereRef(
      "attempt.credentialGeneration",
      "=",
      "entitlement.writerGeneration",
    )
    .where("package.status", "=", "ready")
    .executeTakeFirst();
}

async function findAuthorizedRuntime(
  packageOrigin: string,
): Promise<AuthorizedPackageRuntime | undefined> {
  return await getDatabase()
    .selectFrom("offline_scorm_cleanup_inventory as cleanup")
    .innerJoin(
      "offline_learning_entitlement as entitlement",
      "entitlement.id",
      "cleanup.entitlementId",
    )
    .select([
      "entitlement.id as entitlementId",
      "entitlement.status as entitlementStatus",
      "entitlement.intendedLaunchExpiresAt",
      "cleanup.state as cleanupState",
    ])
    .where("cleanup.packageSiteOrigin", "=", packageOrigin)
    .executeTakeFirst();
}

function equalCapability(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function createOfflineScormPackageHostHandler(
  dependencies: OfflineScormPackageHostDependencies,
): (request: Request) => Promise<Response | null> {
  return async (request) => {
    const suffix = dependencies.configuration.packageHostSuffix;
    if (!suffix) return null;
    const packageOrigin = requestedPackageOrigin(
      request,
      dependencies.configuration,
      suffix,
    );
    if (!packageOrigin) return null;
    const errorHeaders = packageHostHeaders(
      dependencies.configuration,
      "private, no-store",
    );
    const requestUrl = new URL(request.url);
    const lifecyclePath =
      PACKAGE_RUNTIME_PATHS.has(requestUrl.pathname) ||
      requestUrl.pathname === PACKAGE_CLEAR_PATH;
    if (
      !packageOrigin.validLabel ||
      dependencies.configuration.environment === "staging" ||
      (!dependencies.configuration.enabled && !lifecyclePath)
    )
      return new Response(null, { status: 404, headers: errorHeaders });
    if (lifecyclePath) {
      const runtime = await dependencies.findAuthorizedRuntime?.(
        packageOrigin.origin,
      );
      if (!runtime)
        return new Response(null, { status: 404, headers: errorHeaders });
      if (requestUrl.pathname === PACKAGE_CLEAR_PATH) {
        if (
          request.method !== "POST" ||
          request.headers.get("origin") !==
            new URL(dependencies.configuration.learningOrigin).origin ||
          runtime.cleanupState !== "clearing" ||
          runtime.entitlementStatus !== "resolved"
        )
          return new Response(null, { status: 404, headers: errorHeaders });
        const expectedCapability = createOfflineScormPackageCleanupCapability(
          {
            APP_ENV: dependencies.configuration.environment,
            OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY:
              dependencies.configuration.packageSiteOriginKey,
          },
          {
            entitlementId: runtime.entitlementId,
            packageSiteOrigin: packageOrigin.origin,
          },
        );
        const suppliedCapability =
          requestUrl.searchParams.get("capability") ?? "";
        if (!equalCapability(suppliedCapability, expectedCapability))
          return new Response(null, { status: 404, headers: errorHeaders });
        const headers = packageHostHeaders(
          dependencies.configuration,
          "private, no-store",
        );
        headers.set(
          "Access-Control-Allow-Origin",
          new URL(dependencies.configuration.learningOrigin).origin,
        );
        headers.set("Clear-Site-Data", '"cache", "cookies", "storage"');
        headers.set("Cross-Origin-Resource-Policy", "cross-origin");
        headers.set("Content-Type", "application/json; charset=utf-8");
        headers.set("Vary", "Origin");
        return Response.json(
          {
            cleanupReceiptSha256: createOfflineScormPackageCleanupReceipt(
              {
                APP_ENV: dependencies.configuration.environment,
                OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY:
                  dependencies.configuration.packageSiteOriginKey,
              },
              {
                entitlementId: runtime.entitlementId,
                packageSiteOrigin: packageOrigin.origin,
              },
            ),
          },
          { status: 200, headers },
        );
      }
      const runtimeAvailable =
        (runtime.entitlementStatus === "active" &&
          runtime.cleanupState === "pending") ||
        (runtime.entitlementStatus === "resolved" &&
          runtime.cleanupState === "clearing");
      if (
        !runtimeAvailable ||
        (request.method !== "GET" && request.method !== "HEAD")
      )
        return new Response(null, { status: 404, headers: errorHeaders });
      const headers = packageHostHeaders(
        dependencies.configuration,
        "private, no-cache",
      );
      let body: string;
      if (requestUrl.pathname === "/.__upskill_offline__/host.html") {
        headers.set("Content-Type", "text/html; charset=utf-8");
        body = offlineScormPackageHostHtml(
          dependencies.configuration.learningOrigin,
        );
      } else {
        headers.set("Content-Type", "text/javascript; charset=utf-8");
        const assetName =
          requestUrl.pathname === "/.__upskill_offline__/worker.js"
            ? "package-worker.js"
            : requestUrl.pathname === "/.__upskill_offline__/shared.js"
              ? "shared.js"
              : "package-runtime.js";
        body = await (
          dependencies.readRuntimeAsset ?? readOfflineScormRuntimeAsset
        )(assetName);
        if (assetName === "package-worker.js")
          headers.set("Service-Worker-Allowed", "/");
      }
      headers.set("Content-Length", String(Buffer.byteLength(body)));
      return new Response(request.method === "HEAD" ? null : body, {
        status: 200,
        headers,
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      errorHeaders.set("Allow", "GET, HEAD");
      return new Response(null, { status: 405, headers: errorHeaders });
    }

    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(requestUrl.pathname.slice(1));
    } catch {
      return new Response(null, { status: 404, headers: errorHeaders });
    }
    const path = parseScormContentPath(decodedPath);
    if (!path)
      return new Response(null, { status: 404, headers: errorHeaders });

    const authorization = await dependencies.findAuthorizedPackage(
      packageOrigin.origin,
      (dependencies.now ?? (() => new Date()))(),
    );
    if (!authorization)
      return new Response(null, { status: 404, headers: errorHeaders });
    if (authorization.entitlementPackageSha256 !== authorization.packageSha256)
      throw new Error(
        "Offline SCORM entitlement package digest does not match its immutable package",
      );
    const parsedManifest = packageManifestSchema.safeParse(
      authorization.manifest,
    );
    if (!parsedManifest.success)
      throw new Error(
        "Offline SCORM package manifest has no valid immutable file inventory",
      );
    const matchingFiles = parsedManifest.data.files.filter(
      (file) => file.path === path,
    );
    if (matchingFiles.length !== 1)
      return new Response(null, { status: 404, headers: errorHeaders });
    const file = matchingFiles[0];
    if (!file) throw new Error("Offline SCORM package file is unavailable");

    const headers = packageHostHeaders(
      dependencies.configuration,
      "public, max-age=31536000, immutable, no-transform",
    );
    const etag = `"sha256-${file.sha256}"`;
    headers.set("ETag", etag);
    headers.set("X-Upskill-Content-SHA256", file.sha256);
    headers.set(
      "Content-Type",
      resolveScormContentType(path, file.contentType),
    );
    headers.set("Accept-Ranges", "bytes");
    const ifNoneMatch = request.headers.get("if-none-match");
    if (
      ifNoneMatch
        ?.split(",")
        .map((value) => value.trim())
        .some((value) => value === "*" || value === etag)
    )
      return new Response(null, { status: 304, headers });

    const requestedRange = request.headers.get("range");
    const parsedRange = parseScormRange(requestedRange);
    if (requestedRange && !parsedRange)
      return new Response(null, { status: 416, headers: errorHeaders });
    const range =
      request.headers.get("if-range") === null ||
      request.headers.get("if-range") === etag
        ? parsedRange
        : undefined;
    try {
      const object = await dependencies.getObject(
        dependencies.configuration.learningBucket,
        `${authorization.contentPrefix}/${path}`,
        range,
      );
      if (
        !object.contentRange &&
        object.contentLength !== undefined &&
        object.contentLength !== file.sizeBytes
      )
        throw new Error(
          "Offline SCORM stored object length does not match its immutable inventory",
        );
      if (object.contentLength !== undefined)
        headers.set("Content-Length", String(object.contentLength));
      if (object.contentRange)
        headers.set("Content-Range", object.contentRange);
      if (request.method === "HEAD") {
        await object.body.cancel();
        return new Response(null, {
          status: object.contentRange ? 206 : 200,
          headers,
        });
      }
      return new Response(object.body, {
        status: object.contentRange ? 206 : 200,
        headers,
      });
    } catch (error) {
      const status = objectErrorStatus(error);
      if (status === 500) throw error;
      return new Response(null, { status, headers: errorHeaders });
    }
  };
}

export async function handleOfflineScormPackageHostRequest(
  request: Request,
): Promise<Response | null> {
  const environment = getServerEnv();
  return await createOfflineScormPackageHostHandler({
    configuration: {
      applicationOrigin: environment.APP_ORIGIN,
      environment: environment.APP_ENV,
      learningOrigin: environment.LEARNING_ORIGIN,
      learningBucket: environment.S3_LEARNING_CONTENT_BUCKET,
      packageHostSuffix: environment.OFFLINE_SCORM_PACKAGE_HOST_SUFFIX,
      packageSiteOriginKey: environment.OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY,
      enabled: environment.OFFLINE_SCORM_ENABLED,
    },
    findAuthorizedPackage,
    findAuthorizedRuntime,
    getObject: getObjectStream,
  })(request);
}
