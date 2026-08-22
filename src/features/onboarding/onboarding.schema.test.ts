import { describe, expect, it } from "vitest";
import { activateOnboardingSchema } from "./onboarding.schema";

describe("onboarding contracts", () => {
  it("accepts automatically mapped onboarding configuration", () => {
    expect(
      activateOnboardingSchema.safeParse({
        surveyVersionId: "survey_version_1",
        privacyNotice:
          "We use these answers to establish your learner profile.",
        privacyNoticeVersion: "1",
        contactVerificationRequired: false,
      }).success,
    ).toBe(true);
  });

  it("requires the contact-verification policy", () => {
    expect(
      activateOnboardingSchema.safeParse({
        surveyVersionId: "survey_version_1",
        privacyNotice: "Privacy notice",
        privacyNoticeVersion: "1",
      }).success,
    ).toBe(false);
  });
});
