import "@tanstack/react-start/server-only";

import { createHash, createPublicKey, type KeyObject } from "node:crypto";

export function offlineScormPublicKeySha256(publicKeySpki: Uint8Array): string {
  return createHash("sha256").update(publicKeySpki).digest("hex");
}

export function parseOfflineScormP256PublicKey(input: {
  publicKeySpki: Uint8Array;
  expectedSha256?: string;
}): KeyObject | undefined {
  const spki = Buffer.from(input.publicKeySpki);
  if (
    input.expectedSha256 &&
    offlineScormPublicKeySha256(spki) !== input.expectedSha256
  )
    return undefined;
  try {
    const publicKey = createPublicKey({
      key: spki,
      format: "der",
      type: "spki",
    });
    if (
      publicKey.asymmetricKeyType !== "ec" ||
      publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    )
      return undefined;
    const canonicalSpki = publicKey.export({ format: "der", type: "spki" });
    if (!canonicalSpki.equals(spki)) return undefined;
    return publicKey;
  } catch {
    return undefined;
  }
}
