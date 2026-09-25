import {
  offlineScormTrustedEntitlementSchema,
  type OfflineScormTrustedEntitlement,
} from "#/features/scorm/offline-scorm-trusted-runtime";
import { z } from "#/validation/zod";

const OFFLINE_SCORM_ENTITLEMENT_CANONICAL_FORMAT =
  "upskill-offline-scorm-entitlement-v1";

const signingKeyIdSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(100),
    z.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
  );

export const offlineScormUnsignedEntitlementEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  algorithm: z.literal("ecdsa-p256-sha256"),
  signingKeyId: signingKeyIdSchema,
  entitlement: offlineScormTrustedEntitlementSchema,
});

export const offlineScormSignedEntitlementEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  algorithm: z.literal("ecdsa-p256-sha256"),
  signingKeyId: signingKeyIdSchema,
  entitlement: offlineScormTrustedEntitlementSchema,
  signature: z.string().check(z.length(86), z.regex(/^[A-Za-z0-9_-]+$/u)),
});

export type OfflineScormUnsignedEntitlementEnvelope = z.infer<
  typeof offlineScormUnsignedEntitlementEnvelopeSchema
>;
export type OfflineScormSignedEntitlementEnvelope = z.infer<
  typeof offlineScormSignedEntitlementEnvelopeSchema
>;

function normalizeNumber(value: number | null): number | null {
  return value === 0 ? 0 : value;
}

function offeringTuple(
  entitlement: OfflineScormTrustedEntitlement,
): [string, string, string] {
  return entitlement.offering.kind === "course"
    ? [
        "course",
        entitlement.offering.enrollmentId,
        entitlement.offering.courseVersionItemId,
      ]
    : [
        "event",
        entitlement.offering.eventParticipationId,
        entitlement.offering.eventTemplateVersionItemId,
      ];
}

/**
 * Versioned fixed-position JSON tuple shared by the server signer and trusted
 * browser runtime. Array positions are part of the v1 signature contract.
 */
export function canonicalizeOfflineScormEntitlementEnvelope(
  input: OfflineScormUnsignedEntitlementEnvelope,
): string {
  const envelope = offlineScormUnsignedEntitlementEnvelopeSchema.parse(input);
  const { entitlement } = envelope;
  return JSON.stringify([
    OFFLINE_SCORM_ENTITLEMENT_CANONICAL_FORMAT,
    envelope.schemaVersion,
    envelope.algorithm,
    envelope.signingKeyId,
    entitlement.schemaVersion,
    entitlement.entitlementId,
    entitlement.attemptId,
    entitlement.installationId,
    entitlement.learnerId,
    entitlement.devicePublicKeySha256,
    entitlement.historyBaseRevision,
    entitlement.runtimeVersion,
    offeringTuple(entitlement),
    entitlement.packageVersionId,
    entitlement.packageSha256,
    [
      entitlement.initialSnapshot.lessonStatus,
      entitlement.initialSnapshot.location,
      entitlement.initialSnapshot.suspendData,
      normalizeNumber(entitlement.initialSnapshot.scoreRaw),
      normalizeNumber(entitlement.initialSnapshot.scoreMin),
      normalizeNumber(entitlement.initialSnapshot.scoreMax),
      entitlement.initialSnapshot.totalTimeSeconds,
    ],
    entitlement.issuedAt,
    entitlement.intendedLaunchExpiresAt,
    entitlement.commitAcceptanceDeadline,
  ]);
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = globalThis.atob(
    value.replaceAll("-", "+").replaceAll("_", "/"),
  );
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Returns the signed entitlement only when its key identifier resolves to a
 * trusted P-256 public key and its signature covers the canonical envelope.
 */
export async function verifyOfflineScormEntitlementEnvelope(
  input: unknown,
  resolveSigningKey: (
    signingKeyId: string,
  ) => Uint8Array<ArrayBuffer> | undefined,
  cryptoProvider: Pick<Crypto, "subtle"> = globalThis.crypto,
): Promise<OfflineScormTrustedEntitlement | undefined> {
  const parsed = offlineScormSignedEntitlementEnvelopeSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const envelope = parsed.data;
  const publicKeySpki = resolveSigningKey(envelope.signingKeyId);
  if (!publicKeySpki) return undefined;
  try {
    const publicKey = await cryptoProvider.subtle.importKey(
      "spki",
      publicKeySpki,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const unsigned = {
      schemaVersion: envelope.schemaVersion,
      algorithm: envelope.algorithm,
      signingKeyId: envelope.signingKeyId,
      entitlement: envelope.entitlement,
    } satisfies OfflineScormUnsignedEntitlementEnvelope;
    const valid = await cryptoProvider.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      base64UrlToBytes(envelope.signature),
      new TextEncoder().encode(
        canonicalizeOfflineScormEntitlementEnvelope(unsigned),
      ),
    );
    return valid ? envelope.entitlement : undefined;
  } catch {
    return undefined;
  }
}
