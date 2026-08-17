import { describe, expect, it } from "vitest";
import type { SurveyVersionContent } from "./survey.schema";
import { surveyPathItems } from "./survey-branching";

const content: SurveyVersionContent = {
  title: "Onboarding",
  description: "",
  sections: [
    {
      id: "work",
      title: "Work",
      description: "",
      items: [
        {
          id: "works_in_region",
          kind: "single_choice",
          prompt: "Do you work in a region?",
          required: true,
          options: [
            { id: "yes", label: "Yes", nextSectionId: "region" },
            { id: "no", label: "No", nextSectionId: "profile" },
          ],
        },
      ],
    },
    {
      id: "region",
      title: "Region",
      description: "",
      items: [
        {
          id: "region_group",
          kind: "dropdown",
          prompt: "Region group",
          required: true,
          options: [
            { id: "nsw", label: "NSW" },
            { id: "vic", label: "Victoria" },
          ],
        },
      ],
    },
    {
      id: "profile",
      title: "Profile",
      description: "",
      items: [
        {
          id: "role",
          kind: "short_text",
          prompt: "Role",
          required: true,
          maximumLength: 100,
          format: "plain",
        },
      ],
    },
  ],
};

describe("survey branching", () => {
  it("continues through the selected later section", () => {
    expect(
      surveyPathItems(content, { works_in_region: "yes" }).map(
        (item) => item.id,
      ),
    ).toEqual(["works_in_region", "region_group", "role"]);
  });

  it("skips intervening sections for the selected answer", () => {
    expect(
      surveyPathItems(content, { works_in_region: "no" }).map(
        (item) => item.id,
      ),
    ).toEqual(["works_in_region", "role"]);
  });
});
