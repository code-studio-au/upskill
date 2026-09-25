import { describe, expect, it } from "vitest";
import {
  canonicalizeOfflineScormEntitlementEnvelope,
  verifyOfflineScormEntitlementEnvelope,
  type OfflineScormSignedEntitlementEnvelope,
  type OfflineScormUnsignedEntitlementEnvelope,
} from "#/features/scorm/offline-scorm-entitlement";
import { createOfflineScormInstallationRegistration } from "#/features/scorm/offline-scorm-installation";
import {
  createOfflineScormDeviceKeyRecord,
  type OfflineScormTrustedEntitlement,
} from "#/features/scorm/offline-scorm-trusted-runtime";

const trustedEntitlement: OfflineScormTrustedEntitlement = {
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
    scoreMin: -0,
    scoreMax: 100,
    totalTimeSeconds: 120,
  },
  issuedAt: "2026-09-25T00:00:00.000Z",
  intendedLaunchExpiresAt: "2026-10-25T00:00:00.000Z",
  commitAcceptanceDeadline: "2026-11-24T00:00:00.000Z",
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis
    .btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function signedEnvelope(): Promise<{
  envelope: OfflineScormSignedEntitlementEnvelope;
  publicKeySpki: Uint8Array<ArrayBuffer>;
}> {
  const keyPair = await globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const publicKeySpki = new Uint8Array(
    await globalThis.crypto.subtle.exportKey("spki", keyPair.publicKey),
  );
  const unsigned: OfflineScormUnsignedEntitlementEnvelope = {
    schemaVersion: 1,
    algorithm: "ecdsa-p256-sha256",
    signingKeyId: "test-key-1",
    entitlement: trustedEntitlement,
  };
  const signature = new Uint8Array(
    await globalThis.crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      new TextEncoder().encode(
        canonicalizeOfflineScormEntitlementEnvelope(unsigned),
      ),
    ),
  );
  return {
    envelope: { ...unsigned, signature: bytesToBase64Url(signature) },
    publicKeySpki,
  };
}

describe("offline SCORM entitlement envelopes", () => {
  it("serializes the generated device public key for registration", async () => {
    const deviceKey = await createOfflineScormDeviceKeyRecord(
      "installation_1",
      { learnerId: "learner_1" },
    );

    expect(createOfflineScormInstallationRegistration(deviceKey)).toEqual({
      schemaVersion: 1,
      installationId: "installation_1",
      publicKeySpki: bytesToBase64Url(deviceKey.publicKeySpki),
    });
  });

  it("verifies the canonical entitlement with the selected trusted key", async () => {
    const { envelope, publicKeySpki } = await signedEnvelope();

    await expect(
      verifyOfflineScormEntitlementEnvelope(envelope, (keyId) =>
        keyId === "test-key-1" ? publicKeySpki : undefined,
      ),
    ).resolves.toEqual(trustedEntitlement);
  });

  it("rejects payload changes, unknown keys and malformed signatures", async () => {
    const { envelope, publicKeySpki } = await signedEnvelope();
    const tampered = {
      ...envelope,
      entitlement: {
        ...envelope.entitlement,
        packageSha256: "c".repeat(64),
      },
    };

    await expect(
      verifyOfflineScormEntitlementEnvelope(tampered, () => publicKeySpki),
    ).resolves.toBeUndefined();
    await expect(
      verifyOfflineScormEntitlementEnvelope(envelope, () => undefined),
    ).resolves.toBeUndefined();
    await expect(
      verifyOfflineScormEntitlementEnvelope(
        { ...envelope, signature: "not-a-signature" },
        () => publicKeySpki,
      ),
    ).resolves.toBeUndefined();
  });

  it("normalizes negative zero in the signed progress snapshot", () => {
    const unsigned: OfflineScormUnsignedEntitlementEnvelope = {
      schemaVersion: 1,
      algorithm: "ecdsa-p256-sha256",
      signingKeyId: "test-key-1",
      entitlement: trustedEntitlement,
    };
    const positiveZero = {
      ...unsigned,
      entitlement: {
        ...trustedEntitlement,
        initialSnapshot: {
          ...trustedEntitlement.initialSnapshot,
          scoreMin: 0,
        },
      },
    };

    expect(canonicalizeOfflineScormEntitlementEnvelope(unsigned)).toBe(
      canonicalizeOfflineScormEntitlementEnvelope(positiveZero),
    );
  });
});
