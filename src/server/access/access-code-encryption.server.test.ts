import { beforeEach, describe, expect, it } from "vitest";

const LOCAL_TEST_KEY = "bG9jYWwtb25seS11cHNraWxsLWFjY2Vzcy1rZXktdjE";

describe("access-code authenticated encryption", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.BETTER_AUTH_SECRET =
      "test-only-secret-that-is-at-least-32-characters";
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_placeholder";
    process.env.ACCESS_CODE_ENCRYPTION_KEY = LOCAL_TEST_KEY;
  });

  it("can repeatedly decrypt one ciphertext without changing it", async () => {
    const { decryptAccessCode, encryptAccessCode } =
      await import("./access-code-encryption.server");
    const protectedCode = encryptAccessCode({
      accessGrantId: "grant_one",
      lookupId: "K7M4P9Q2WX",
      accessCode: "MEAL-SUPPORT-2027-K7M4P9Q2WX",
    });
    expect(protectedCode).not.toContain("MEAL-SUPPORT");
    expect(
      decryptAccessCode({
        accessGrantId: "grant_one",
        lookupId: "K7M4P9Q2WX",
        encryptedAccessCode: protectedCode,
      }),
    ).toBe("MEAL-SUPPORT-2027-K7M4P9Q2WX");
    expect(
      decryptAccessCode({
        accessGrantId: "grant_one",
        lookupId: "K7M4P9Q2WX",
        encryptedAccessCode: protectedCode,
      }),
    ).toBe("MEAL-SUPPORT-2027-K7M4P9Q2WX");
  });

  it("rejects ciphertext tampering and cross-grant substitution", async () => {
    const { AccessCodeProtectionError, decryptAccessCode, encryptAccessCode } =
      await import("./access-code-encryption.server");
    const protectedCode = encryptAccessCode({
      accessGrantId: "grant_one",
      lookupId: "K7M4P9Q2WX",
      accessCode: "MEAL-SUPPORT-2027-K7M4P9Q2WX",
    });
    const tampered = `${protectedCode.slice(0, -1)}${protectedCode.endsWith("A") ? "B" : "A"}`;
    expect(() =>
      decryptAccessCode({
        accessGrantId: "grant_one",
        lookupId: "K7M4P9Q2WX",
        encryptedAccessCode: tampered,
      }),
    ).toThrow(AccessCodeProtectionError);
    expect(() =>
      decryptAccessCode({
        accessGrantId: "grant_two",
        lookupId: "K7M4P9Q2WX",
        encryptedAccessCode: protectedCode,
      }),
    ).toThrow(AccessCodeProtectionError);
  });

  it("compares normalized submitted codes after authenticated decryption", async () => {
    const { encryptedAccessCodeMatches, encryptAccessCode } =
      await import("./access-code-encryption.server");
    const protectedCode = encryptAccessCode({
      accessGrantId: "grant_one",
      lookupId: "K7M4P9Q2WX",
      accessCode: "MEAL-SUPPORT-2027-K7M4P9Q2WX",
    });
    expect(
      encryptedAccessCodeMatches({
        accessGrantId: "grant_one",
        lookupId: "K7M4P9Q2WX",
        encryptedAccessCode: protectedCode,
        submittedAccessCode: "meal support 2027 k7m4p9q2wx",
      }),
    ).toBe(true);
    expect(
      encryptedAccessCodeMatches({
        accessGrantId: "grant_one",
        lookupId: "K7M4P9Q2WX",
        encryptedAccessCode: protectedCode,
        submittedAccessCode: "wrong-code-2027-k7m4p9q2wx",
      }),
    ).toBe(false);
  });
});
