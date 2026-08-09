import { describe, expect, it } from "vitest";
import {
  adminLearnerParamsSchema,
  adminLearnerSearchSchema,
  adminProgressOverrideInputSchema,
} from "./admin.schema";

describe("admin learner inputs", () => {
  it("normalizes search input and invalid pages", () => {
    expect(
      adminLearnerSearchSchema.parse({ q: "  learner@example.com ", page: 0 }),
    ).toEqual({ q: "learner@example.com", page: 1 });
  });

  it("rejects path-like learner identifiers", () => {
    expect(() =>
      adminLearnerParamsSchema.parse({ userId: "../learner" }),
    ).toThrow();
  });

  it("normalizes audited course progress corrections", () => {
    expect(
      adminProgressOverrideInputSchema.parse({
        enrollmentId: "enrollment_123",
        scope: "enrollment",
        state: "completed",
        reason: "  Verified external completion evidence.  ",
      }),
    ).toEqual({
      enrollmentId: "enrollment_123",
      scope: "enrollment",
      modulePosition: null,
      state: "completed",
      reason: "Verified external completion evidence.",
    });
  });

  it("requires a mapped module position and meaningful reason", () => {
    expect(
      adminProgressOverrideInputSchema.safeParse({
        enrollmentId: "enrollment_123",
        scope: "module",
        state: "incomplete",
        reason: "too short",
      }).success,
    ).toBe(false);
  });
});
