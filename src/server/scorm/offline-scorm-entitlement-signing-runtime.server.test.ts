import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyOfflineScormEntitlementEnvelope } from "#/features/scorm/offline-scorm-entitlement";
import type { OfflineScormTrustedEntitlement } from "#/features/scorm/offline-scorm-trusted-runtime";
import { createOfflineScormEntitlementSigningRuntime } from "#/server/scorm/offline-scorm-entitlement-signing-runtime.server";

const entitlement: OfflineScormTrustedEntitlement = {
  schemaVersion: 1,
  entitlementId: "entitlement_1",
  attemptId: "attempt_1",
  installationId: "installation_1",
  learnerId: "learner_1",
  devicePublicKeySha256: "b".repeat(64),
  historyBaseRevision: 4,
  runtimeVersion: "offline-scorm-1",
  offering: {
    kind: "course",
    enrollmentId: "enrollment_1",
    courseVersionItemId: "course_item_1",
  },
  packageVersionId: "package_version_1",
  packageSha256: "a".repeat(64),
  initialSnapshot: {
    lessonStatus: "incomplete",
    location: "page-2",
    suspendData: "saved-state",
    scoreRaw: 0,
    scoreMin: 0,
    scoreMax: 100,
    totalTimeSeconds: 120,
  },
  issuedAt: "2026-09-25T00:00:00.000Z",
  intendedLaunchExpiresAt: "2026-10-25T00:00:00.000Z",
  commitAcceptanceDeadline: "2026-11-24T00:00:00.000Z",
};

function privateKeyPkcs8(namedCurve = "prime256v1"): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve });
  return privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("base64url");
}

describe("offline SCORM runtime signing authority", () => {
  it("loads a canonical P-256 key and exposes the matching trusted public key", async () => {
    const runtime = createOfflineScormEntitlementSigningRuntime({
      OFFLINE_SCORM_ENABLED: true,
      OFFLINE_SCORM_ENTITLEMENT_SIGNING_KEY_ID: "test-key-1",
      OFFLINE_SCORM_ENTITLEMENT_SIGNING_PRIVATE_KEY_PKCS8: privateKeyPkcs8(),
    });
    const envelope = runtime.signer(entitlement);

    expect(runtime.trustedPublicKey).toMatchObject({
      algorithm: "ecdsa-p256-sha256",
      signingKeyId: "test-key-1",
    });
    await expect(
      verifyOfflineScormEntitlementEnvelope(envelope, (signingKeyId) =>
        signingKeyId === runtime.trustedPublicKey.signingKeyId
          ? Buffer.from(runtime.trustedPublicKey.publicKeySpki, "base64url")
          : undefined,
      ),
    ).resolves.toEqual(entitlement);
  });

  it("fails closed while disabled or when key material is malformed", () => {
    expect(() =>
      createOfflineScormEntitlementSigningRuntime({
        OFFLINE_SCORM_ENABLED: false,
      }),
    ).toThrow("activation is disabled");
    expect(() =>
      createOfflineScormEntitlementSigningRuntime({
        OFFLINE_SCORM_ENABLED: true,
        OFFLINE_SCORM_ENTITLEMENT_SIGNING_KEY_ID: "test-key-1",
        OFFLINE_SCORM_ENTITLEMENT_SIGNING_PRIVATE_KEY_PKCS8: `${privateKeyPkcs8()}=`,
      }),
    ).toThrow("canonical base64url");
    expect(() =>
      createOfflineScormEntitlementSigningRuntime({
        OFFLINE_SCORM_ENABLED: true,
        OFFLINE_SCORM_ENTITLEMENT_SIGNING_KEY_ID: "test-key-1",
        OFFLINE_SCORM_ENTITLEMENT_SIGNING_PRIVATE_KEY_PKCS8:
          privateKeyPkcs8("secp384r1"),
      }),
    ).toThrow("requires a P-256 key");
  });
});
