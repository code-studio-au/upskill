import "@tanstack/react-start/server-only";

import { createHmac } from "node:crypto";
import {
  assertOfflineScormPackageOriginIsolation,
  parseOfflineScormPackageSiteSuffix,
} from "#/features/scorm/offline-scorm-package-site.ts";
import type { ServerEnv } from "#/server/env.server.ts";

const PACKAGE_SITE_DERIVATION_FORMAT = "upskill-offline-scorm-package-site-v1";
const PACKAGE_CLEANUP_DERIVATION_FORMAT =
  "upskill-offline-scorm-package-cleanup-v1";
const PACKAGE_CLEANUP_RECEIPT_FORMAT =
  "upskill-offline-scorm-package-cleanup-receipt-v1";

type OfflineScormPackageSiteConfiguration = Pick<
  ServerEnv,
  | "APP_ENV"
  | "APP_ORIGIN"
  | "LEARNING_ORIGIN"
  | "OFFLINE_SCORM_ENABLED"
  | "OFFLINE_SCORM_PACKAGE_SITE_SUFFIX"
  | "OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY"
>;

export type OfflineScormPackageSiteProvisioner = (input: {
  attemptId: string;
  entitlementId: string;
}) => string;

function decodeOriginKey(value: string): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== value)
    throw new Error(
      "Offline SCORM package-site origin key must be canonical base64url encoding of 256 bits",
    );
  return decoded;
}

function assertInternalId(label: string, value: string): void {
  if (
    value.length < 1 ||
    value.length > 255 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  )
    throw new Error(`Offline SCORM ${label} is invalid`);
}

export function createOfflineScormPackageSiteProvisioner(
  configuration: OfflineScormPackageSiteConfiguration,
): OfflineScormPackageSiteProvisioner {
  if (!configuration.OFFLINE_SCORM_ENABLED)
    throw new Error("Offline SCORM activation is disabled");
  if (!configuration.OFFLINE_SCORM_PACKAGE_SITE_SUFFIX)
    throw new Error("Offline SCORM package-site suffix is not configured");
  if (!configuration.OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY)
    throw new Error("Offline SCORM package-site origin key is not configured");
  const suffix = parseOfflineScormPackageSiteSuffix(
    configuration.OFFLINE_SCORM_PACKAGE_SITE_SUFFIX,
    configuration.APP_ENV,
  );
  const originKey = decodeOriginKey(
    configuration.OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY,
  );

  return ({ attemptId, entitlementId }) => {
    assertInternalId("attempt identifier", attemptId);
    assertInternalId("entitlement identifier", entitlementId);
    const hostnameLabel = `p-${createHmac("sha256", originKey)
      .update(PACKAGE_SITE_DERIVATION_FORMAT, "utf8")
      .update("\0", "utf8")
      .update(attemptId, "utf8")
      .update("\0", "utf8")
      .update(entitlementId, "utf8")
      .digest("hex")
      .slice(0, 56)}`;
    const packageOrigin = (() => {
      if (suffix !== "localhost") return `https://${hostnameLabel}.${suffix}`;
      const applicationOrigin = new URL(configuration.APP_ORIGIN);
      const learningOrigin = new URL(configuration.LEARNING_ORIGIN);
      if (
        applicationOrigin.protocol !== "http:" ||
        !applicationOrigin.hostname.endsWith(".localhost") ||
        learningOrigin.protocol !== "http:" ||
        !learningOrigin.hostname.endsWith(".localhost") ||
        applicationOrigin.port !== learningOrigin.port
      )
        throw new Error(
          "Local offline SCORM requires HTTP .localhost application and learning origins on one port",
        );
      return `http://${hostnameLabel}.${suffix}${applicationOrigin.port ? `:${applicationOrigin.port}` : ""}`;
    })();
    assertOfflineScormPackageOriginIsolation({
      applicationOrigin: configuration.APP_ORIGIN,
      learningOrigin: configuration.LEARNING_ORIGIN,
      packageOrigin,
    });
    return packageOrigin;
  };
}

export function createOfflineScormPackageCleanupCapability(
  configuration: Pick<
    OfflineScormPackageSiteConfiguration,
    "APP_ENV" | "OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY"
  >,
  input: { entitlementId: string; packageSiteOrigin: string },
): string {
  if (!configuration.OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY)
    throw new Error("Offline SCORM package-site origin key is not configured");
  assertInternalId("entitlement identifier", input.entitlementId);
  const packageSiteOrigin = parseCleanupPackageSiteOrigin(
    configuration.APP_ENV,
    input.packageSiteOrigin,
  );
  return createHmac(
    "sha256",
    decodeOriginKey(configuration.OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY),
  )
    .update(PACKAGE_CLEANUP_DERIVATION_FORMAT, "utf8")
    .update("\0", "utf8")
    .update(input.entitlementId, "utf8")
    .update("\0", "utf8")
    .update(packageSiteOrigin.origin, "utf8")
    .digest("base64url");
}

export function createOfflineScormPackageCleanupReceipt(
  configuration: Pick<
    OfflineScormPackageSiteConfiguration,
    "APP_ENV" | "OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY"
  >,
  input: { entitlementId: string; packageSiteOrigin: string },
): string {
  if (!configuration.OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY)
    throw new Error("Offline SCORM package-site origin key is not configured");
  assertInternalId("entitlement identifier", input.entitlementId);
  const packageSiteOrigin = parseCleanupPackageSiteOrigin(
    configuration.APP_ENV,
    input.packageSiteOrigin,
  );
  return createHmac(
    "sha256",
    decodeOriginKey(configuration.OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY),
  )
    .update(PACKAGE_CLEANUP_RECEIPT_FORMAT, "utf8")
    .update("\0", "utf8")
    .update(input.entitlementId, "utf8")
    .update("\0", "utf8")
    .update(packageSiteOrigin.origin, "utf8")
    .digest("hex");
}

function parseCleanupPackageSiteOrigin(
  environment: OfflineScormPackageSiteConfiguration["APP_ENV"],
  value: string,
): URL {
  const origin = new URL(value);
  const localHttpOrigin =
    (environment === "development" || environment === "test") &&
    origin.protocol === "http:" &&
    origin.hostname.endsWith(".localhost");
  if (
    origin.origin !== value ||
    (origin.protocol !== "https:" && !localHttpOrigin)
  )
    throw new Error("Offline SCORM package-site origin is invalid");
  return origin;
}
