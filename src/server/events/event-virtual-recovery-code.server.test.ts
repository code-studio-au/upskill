import { beforeEach, describe, expect, it } from "vitest";

const LOCAL_TEST_KEY = "bG9jYWwtb25seS11cHNraWxsLWFjY2Vzcy1rZXktdjE";

describe("event virtual recovery-code protection", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.BETTER_AUTH_SECRET =
      "test-only-secret-that-is-at-least-32-characters";
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_placeholder";
    process.env.ACCESS_CODE_ENCRYPTION_KEY = LOCAL_TEST_KEY;
  });

  it("decrypts only for the challenge used as authenticated context", async () => {
    const { decryptEventVirtualRecoveryCode, encryptEventVirtualRecoveryCode } =
      await import("./event-virtual-recovery-code.server");
    const encryptedCode = encryptEventVirtualRecoveryCode(
      "event_virtual_recovery_challenge_1",
      "123456",
    );

    expect(
      decryptEventVirtualRecoveryCode(
        "event_virtual_recovery_challenge_1",
        encryptedCode,
      ),
    ).toBe("123456");
    expect(() =>
      decryptEventVirtualRecoveryCode(
        "event_virtual_recovery_challenge_2",
        encryptedCode,
      ),
    ).toThrow("Event virtual recovery-code protection failed");
  });

  it("rejects ciphertext tampering", async () => {
    const { decryptEventVirtualRecoveryCode, encryptEventVirtualRecoveryCode } =
      await import("./event-virtual-recovery-code.server");
    const challengeId = "event_virtual_recovery_challenge_1";
    const encryptedCode = encryptEventVirtualRecoveryCode(
      challengeId,
      "654321",
    );
    const parts = encryptedCode.split(".");
    const ciphertext = parts[2];
    if (!ciphertext)
      throw new Error("Encrypted test fixture has no ciphertext");
    parts[2] = `${ciphertext.slice(0, -1)}${ciphertext.endsWith("A") ? "B" : "A"}`;

    expect(() =>
      decryptEventVirtualRecoveryCode(challengeId, parts.join(".")),
    ).toThrow("Event virtual recovery-code protection failed");
  });
});
