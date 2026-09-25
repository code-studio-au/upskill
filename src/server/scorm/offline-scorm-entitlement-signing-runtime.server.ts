import "@tanstack/react-start/server-only";

import { createPrivateKey, createPublicKey } from "node:crypto";
import type { ServerEnv } from "#/server/env.server";
import {
  createOfflineScormEntitlementSigner,
  type OfflineScormEntitlementSigner,
} from "#/server/scorm/offline-scorm-entitlement-signing.server";

type OfflineScormSigningConfiguration = Pick<
  ServerEnv,
  | "OFFLINE_SCORM_ENABLED"
  | "OFFLINE_SCORM_ENTITLEMENT_SIGNING_KEY_ID"
  | "OFFLINE_SCORM_ENTITLEMENT_SIGNING_PRIVATE_KEY_PKCS8"
>;

export interface OfflineScormEntitlementSigningRuntime {
  signer: OfflineScormEntitlementSigner;
  trustedPublicKey: {
    algorithm: "ecdsa-p256-sha256";
    signingKeyId: string;
    publicKeySpki: string;
  };
}

function decodeCanonicalBase64Url(value: string): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength === 0 || decoded.toString("base64url") !== value)
    throw new Error(
      "Offline SCORM signing private key must use canonical base64url",
    );
  return decoded;
}

export function createOfflineScormEntitlementSigningRuntime(
  configuration: OfflineScormSigningConfiguration,
): OfflineScormEntitlementSigningRuntime {
  if (!configuration.OFFLINE_SCORM_ENABLED)
    throw new Error("Offline SCORM activation is disabled");
  const signingKeyId = configuration.OFFLINE_SCORM_ENTITLEMENT_SIGNING_KEY_ID;
  const encodedPrivateKey =
    configuration.OFFLINE_SCORM_ENTITLEMENT_SIGNING_PRIVATE_KEY_PKCS8;
  if (!signingKeyId || !encodedPrivateKey)
    throw new Error("Offline SCORM signing authority is not configured");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(signingKeyId))
    throw new Error("Offline SCORM signing key identifier is invalid");

  const privateKeyBytes = decodeCanonicalBase64Url(encodedPrivateKey);
  let privateKey;
  try {
    privateKey = createPrivateKey({
      key: privateKeyBytes,
      format: "der",
      type: "pkcs8",
    });
  } catch (error) {
    throw new Error("Offline SCORM signing private key is invalid", {
      cause: error,
    });
  }
  const canonicalPrivateKey = privateKey.export({
    format: "der",
    type: "pkcs8",
  });
  if (
    !Buffer.isBuffer(canonicalPrivateKey) ||
    !canonicalPrivateKey.equals(privateKeyBytes)
  )
    throw new Error("Offline SCORM signing private key is not canonical PKCS8");

  const signer = createOfflineScormEntitlementSigner({
    signingKeyId,
    privateKey,
  });
  const publicKeySpki = createPublicKey(privateKey).export({
    format: "der",
    type: "spki",
  });
  if (!Buffer.isBuffer(publicKeySpki))
    throw new Error("Offline SCORM signing public key could not be exported");
  return {
    signer,
    trustedPublicKey: {
      algorithm: "ecdsa-p256-sha256",
      signingKeyId,
      publicKeySpki: publicKeySpki.toString("base64url"),
    },
  };
}
