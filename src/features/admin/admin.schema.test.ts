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

  it("normalizes audited course progress corrections without a reason", () => {
    expect(
      adminProgressOverrideInputSchema.parse({
        enrollmentId: "enrollment_123",
        scope: "enrollment",
        state: "completed",
      }),
    ).toEqual({
      enrollmentId: "enrollment_123",
      scope: "enrollment",
      modulePosition: null,
      state: "completed",
    });
  });

  it("requires a mapped module position", () => {
    expect(
      adminProgressOverrideInputSchema.safeParse({
        enrollmentId: "enrollment_123",
        scope: "module",
        state: "incomplete",
      }).success,
    ).toBe(false);
  });
});
