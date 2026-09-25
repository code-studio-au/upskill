import "@tanstack/react-start/server-only";

import { sign, type KeyObject } from "node:crypto";
import {
  canonicalizeOfflineScormEntitlementEnvelope,
  offlineScormSignedEntitlementEnvelopeSchema,
  offlineScormUnsignedEntitlementEnvelopeSchema,
  type OfflineScormSignedEntitlementEnvelope,
} from "#/features/scorm/offline-scorm-entitlement";
import type { OfflineScormTrustedEntitlement } from "#/features/scorm/offline-scorm-trusted-runtime";

export interface OfflineScormEntitlementSigningAuthority {
  signingKeyId: string;
  privateKey: KeyObject;
}

export type OfflineScormEntitlementSigner = (
  entitlement: OfflineScormTrustedEntitlement,
) => OfflineScormSignedEntitlementEnvelope;

export function createOfflineScormEntitlementSigner(
  authority: OfflineScormEntitlementSigningAuthority,
): OfflineScormEntitlementSigner {
  if (
    authority.privateKey.type !== "private" ||
    authority.privateKey.asymmetricKeyType !== "ec" ||
    authority.privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  )
    throw new Error("Offline SCORM entitlement signing requires a P-256 key");

  return (entitlement) => {
    const unsigned = offlineScormUnsignedEntitlementEnvelopeSchema.parse({
      schemaVersion: 1,
      algorithm: "ecdsa-p256-sha256",
      signingKeyId: authority.signingKeyId,
      entitlement,
    });
    const signature = sign(
      "sha256",
      Buffer.from(
        canonicalizeOfflineScormEntitlementEnvelope(unsigned),
        "utf8",
      ),
      { key: authority.privateKey, dsaEncoding: "ieee-p1363" },
    ).toString("base64url");
    return offlineScormSignedEntitlementEnvelopeSchema.parse({
      ...unsigned,
      signature,
    });
  };
}
