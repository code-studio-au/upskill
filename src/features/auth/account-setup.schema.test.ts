import { describe, expect, it } from "vitest";
import {
  accountSetupPasswordSchema,
  accountSetupTokenSchema,
} from "./account-setup.schema";

describe("account setup validation", () => {
  it("accepts only 256-bit base64url setup tokens", () => {
    expect(accountSetupTokenSchema.safeParse("a".repeat(43)).success).toBe(
      true,
    );
    expect(accountSetupTokenSchema.safeParse("short").success).toBe(false);
    expect(
      accountSetupTokenSchema.safeParse(`${"a".repeat(42)}+`).success,
    ).toBe(false);
  });

  it("requires a strong matching password", () => {
    expect(
      accountSetupPasswordSchema.safeParse({
        password: "a sufficiently long password",
        confirmPassword: "a sufficiently long password",
      }).success,
    ).toBe(true);
    expect(
      accountSetupPasswordSchema.safeParse({
        password: "short",
        confirmPassword: "different",
      }).success,
    ).toBe(false);
  });
});
