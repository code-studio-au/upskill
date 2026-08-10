import { describe, expect, it } from "vitest";
import {
  adminAccessGrantCreateSchema,
  normalizeAdminAccessDomains,
} from "./admin-access.schema";

const valid = {
  label: "Hospital team",
  organizationName: "Example Health",
  accessCode: "EXAMPLE-HEALTH-2027",
  courseVersionId: "course_version_1",
  quantity: 25,
  enrollmentDurationDays: 365,
  expiresOn: "2027-12-31",
  domains: "Example.com, staff.example.org",
};

describe("administrator access-grant validation", () => {
  it("normalizes and deduplicates domain restrictions", () => {
    expect(normalizeAdminAccessDomains(valid.domains)).toEqual([
      "example.com",
      "staff.example.org",
    ]);
    expect(normalizeAdminAccessDomains("example.com EXAMPLE.COM")).toEqual([
      "example.com",
    ]);
  });

  it("accepts an unrestricted grant", () => {
    expect(
      adminAccessGrantCreateSchema.safeParse({ ...valid, domains: "" }).success,
    ).toBe(true);
  });

  it("rejects malformed domains and invalid capacity", () => {
    expect(
      adminAccessGrantCreateSchema.safeParse({
        ...valid,
        domains: "https://example.com",
        quantity: 0,
      }).success,
    ).toBe(false);
  });

  it("accepts memorable codes and rejects punctuation", () => {
    expect(
      adminAccessGrantCreateSchema.safeParse({
        ...valid,
        accessCode: "Meal Support 2027",
      }).success,
    ).toBe(true);
    expect(
      adminAccessGrantCreateSchema.safeParse({
        ...valid,
        accessCode: "meal_support!",
      }).success,
    ).toBe(false);
  });

  it("counts meaningful code characters rather than separators", () => {
    expect(
      adminAccessGrantCreateSchema.safeParse({
        ...valid,
        accessCode: "A-A-A-A-A",
      }).success,
    ).toBe(false);
    expect(
      adminAccessGrantCreateSchema.safeParse({
        ...valid,
        accessCode: "A".repeat(65),
      }).success,
    ).toBe(false);
  });
});
