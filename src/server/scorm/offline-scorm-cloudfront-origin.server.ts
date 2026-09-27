import "@tanstack/react-start/server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const OFFLINE_SCORM_CLOUDFRONT_ENTITLEMENT_HEADER =
  "X-Upskill-Offline-Entitlement";
export const OFFLINE_SCORM_CLOUDFRONT_CAPABILITY_HEADER =
  "X-Upskill-Offline-Origin-Capability";

const ORIGIN_CAPABILITY_FORMAT =
  "upskill-offline-scorm-cloudfront-origin-capability-v1";
const ENTITLEMENT_ID = /^[A-Za-z0-9_-]{1,255}$/u;
const ORIGIN_CAPABILITY = /^[A-Za-z0-9_-]{43}$/u;

type CloudFrontEnvironment = "staging" | "production";

function assertOriginKey(originKey: string): void {
  if (originKey.length < 43 || originKey.length > 512)
    throw new Error("Offline SCORM CloudFront origin key is invalid");
}

function assertEntitlementId(entitlementId: string): void {
  if (!ENTITLEMENT_ID.test(entitlementId))
    throw new Error("Offline SCORM entitlement identifier is invalid");
}

export function createOfflineScormCloudFrontOriginCapability(
  originKey: string,
  environment: CloudFrontEnvironment,
  entitlementId: string,
): string {
  assertOriginKey(originKey);
  assertEntitlementId(entitlementId);
  return createHmac("sha256", originKey)
    .update(ORIGIN_CAPABILITY_FORMAT, "utf8")
    .update("\0", "utf8")
    .update(environment, "utf8")
    .update("\0", "utf8")
    .update(entitlementId, "utf8")
    .digest("base64url");
}

export function verifyOfflineScormCloudFrontOriginCapability(input: {
  actualCapability: string;
  entitlementId: string;
  environment: CloudFrontEnvironment;
  originKey: string;
}): boolean {
  if (
    !ENTITLEMENT_ID.test(input.entitlementId) ||
    !ORIGIN_CAPABILITY.test(input.actualCapability)
  )
    return false;
  const expectedCapability = createOfflineScormCloudFrontOriginCapability(
    input.originKey,
    input.environment,
    input.entitlementId,
  );
  return timingSafeEqual(
    Buffer.from(input.actualCapability, "utf8"),
    Buffer.from(expectedCapability, "utf8"),
  );
}
