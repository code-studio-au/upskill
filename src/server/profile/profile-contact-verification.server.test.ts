import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  environment: { APP_ENV: "test" },
}));

vi.mock("#/server/env.server", () => ({
  getServerEnv: () => mocks.environment,
}));

describe("profile verification challenge cookies", () => {
  beforeEach(() => {
    mocks.environment.APP_ENV = "test";
  });

  it("uses the root path required by secure __Host cookies", async () => {
    mocks.environment.APP_ENV = "production";
    const {
      clearProfileVerificationChallengeCookie,
      profileVerificationChallengeCookie,
    } = await import("./profile-contact-verification.server");
    const reference = "Q234567890_bcdefghijklmnopqrstuv";

    expect(profileVerificationChallengeCookie(reference)).toBe(
      `__Host-upskill_profile_challenge=${reference}; Path=/; HttpOnly; SameSite=Strict; Max-Age=600; Secure`,
    );
    expect(clearProfileVerificationChallengeCookie()).toBe(
      "__Host-upskill_profile_challenge=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure",
    );
  });

  it("keeps the local cookie host-only without requiring HTTPS", async () => {
    const { profileVerificationChallengeCookie } =
      await import("./profile-contact-verification.server");

    expect(profileVerificationChallengeCookie("a".repeat(32))).toBe(
      `upskill_profile_challenge=${"a".repeat(32)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=600`,
    );
  });
});
