import { describe, expect, it } from "vitest";
import { activateOnboardingSchema } from "./onboarding.schema";

describe("onboarding contracts", () => {
  it("accepts unique allowlisted profile mappings", () => {
    expect(
      activateOnboardingSchema.safeParse({
        surveyVersionId: "survey_version_1",
        privacyNotice:
          "We use these answers to establish your learner profile.",
        privacyNoticeVersion: "1",
        profileMappings: [
          { questionId: "name", destination: "name" },
          { questionId: "region", destination: "currentRegionId" },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate profile destinations", () => {
    expect(
      activateOnboardingSchema.safeParse({
        surveyVersionId: "survey_version_1",
        privacyNotice: "Privacy notice",
        privacyNoticeVersion: "1",
        profileMappings: [
          { questionId: "name", destination: "name" },
          { questionId: "other_name", destination: "name" },
        ],
      }).success,
    ).toBe(false);
  });
});
