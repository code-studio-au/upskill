import "@tanstack/react-start/server-only";

import { createHmac } from "node:crypto";
import {
  assertOfflineScormPackageOriginIsolation,
  parseOfflineScormPrivateSiteSuffix,
} from "#/features/scorm/offline-scorm-package-site";
import type { ServerEnv } from "#/server/env.server";

const PACKAGE_SITE_DERIVATION_FORMAT = "upskill-offline-scorm-package-site-v1";

type OfflineScormPackageSiteConfiguration = Pick<
  ServerEnv,
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
  const suffix = parseOfflineScormPrivateSiteSuffix(
    configuration.OFFLINE_SCORM_PACKAGE_SITE_SUFFIX,
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
    const packageOrigin = `https://${hostnameLabel}.${suffix}`;
    assertOfflineScormPackageOriginIsolation({
      applicationOrigin: configuration.APP_ORIGIN,
      learningOrigin: configuration.LEARNING_ORIGIN,
      packageOrigin,
    });
    return packageOrigin;
  };
}
