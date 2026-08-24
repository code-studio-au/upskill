import { describe, expect, it } from "vitest";
import { learnerProfileUpdateSchema } from "./learner-profile.schema";

describe("learner profile update", () => {
  it("accepts mapped profile fields with an international mobile", () => {
    expect(
      learnerProfileUpdateSchema.safeParse({
        name: "Learner Four",
        phone: "+61 433 519 110",
        currentRegionId: "coordination_region_sydney",
        emailEnabled: true,
        smsEnabled: true,
      }).success,
    ).toBe(true);
  });

  it("requires a valid mobile before SMS can be enabled", () => {
    expect(
      learnerProfileUpdateSchema.safeParse({
        name: "Learner Four",
        phone: "0433 519 110",
        currentRegionId: "",
        emailEnabled: true,
        smsEnabled: true,
      }).success,
    ).toBe(false);
    expect(
      learnerProfileUpdateSchema.safeParse({
        name: "Learner Four",
        phone: "",
        currentRegionId: "",
        emailEnabled: true,
        smsEnabled: true,
      }).success,
    ).toBe(false);
  });
});
