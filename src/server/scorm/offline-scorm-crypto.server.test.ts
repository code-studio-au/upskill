import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseOfflineScormP256PublicKey } from "#/server/scorm/offline-scorm-crypto.server";

function publicKeySpki(namedCurve: "prime256v1" | "secp384r1"): Buffer {
  return generateKeyPairSync("ec", { namedCurve }).publicKey.export({
    format: "der",
    type: "spki",
  });
}

describe("offline SCORM public-key parsing", () => {
  it("accepts an exact canonical P-256 SPKI with its matching digest", () => {
    const spki = publicKeySpki("prime256v1");

    expect(
      parseOfflineScormP256PublicKey({
        publicKeySpki: spki,
        expectedSha256: createHash("sha256").update(spki).digest("hex"),
      }),
    ).toBeDefined();
  });

  it("rejects trailing DER data even when the decorated digest matches", () => {
    const decorated = Buffer.concat([
      publicKeySpki("prime256v1"),
      Buffer.from([0xde, 0xad]),
    ]);

    expect(
      parseOfflineScormP256PublicKey({
        publicKeySpki: decorated,
        expectedSha256: createHash("sha256").update(decorated).digest("hex"),
      }),
    ).toBeUndefined();
  });

  it("rejects another EC curve and a mismatched digest", () => {
    const p384 = publicKeySpki("secp384r1");
    const p256 = publicKeySpki("prime256v1");

    expect(
      parseOfflineScormP256PublicKey({ publicKeySpki: p384 }),
    ).toBeUndefined();
    expect(
      parseOfflineScormP256PublicKey({
        publicKeySpki: p256,
        expectedSha256: "0".repeat(64),
      }),
    ).toBeUndefined();
  });
});
