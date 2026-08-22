import { describe, expect, it } from "vitest";
import {
  eventRecoveryReferenceSchema,
  eventRecoveryRequestSchema,
  eventRecoveryVerificationSchema,
} from "./event-recovery.schema";

describe("event prerequisite recovery schemas", () => {
  const publicReference = "A234567890_bcdefghijklmnopqrstuv";

  it("accepts email and international mobile identifiers", () => {
    expect(
      eventRecoveryRequestSchema.parse({
        publicReference,
        identifier: "  learner@example.com  ",
      }),
    ).toEqual({ publicReference, identifier: "learner@example.com" });
    expect(
      eventRecoveryRequestSchema.safeParse({
        publicReference,
        identifier: "+61 400 000 000",
      }).success,
    ).toBe(true);
  });

  it("requires a six-digit code and opaque challenge reference", () => {
    expect(
      eventRecoveryVerificationSchema.safeParse({
        publicReference,
        challengeReference: publicReference,
        code: "123456",
      }).success,
    ).toBe(true);
    expect(
      eventRecoveryVerificationSchema.safeParse({
        publicReference,
        challengeReference: publicReference,
        code: "12345",
      }).success,
    ).toBe(false);
    expect(
      eventRecoveryReferenceSchema.safeParse({ publicReference: "survey-1" })
        .success,
    ).toBe(false);
  });
});
