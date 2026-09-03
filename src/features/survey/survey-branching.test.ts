import { describe, expect, it } from "vitest";
import type { SurveyVersionContent } from "./survey.schema";
import {
  allSurveyPathsIncludeOperationalRegion,
  operationalRegionPathsIncludeRegionGroup,
  surveyPathItems,
} from "./survey-branching";

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
const workSection = content.sections[0];
const profileSection = content.sections[2];
if (!workSection || !profileSection)
  throw new Error("Expected survey branching fixture sections");

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

  it("accepts operational-region paths that first traverse region group", () => {
    const regionContent: SurveyVersionContent = {
      ...content,
      sections: [
        workSection,
        {
          id: "region",
          title: "Region group",
          description: "",
          items: [
            {
              id: "region_group",
              kind: "dropdown",
              prompt: "Region group",
              required: true,
              optionSource: "coordination_region_groups",
              options: [],
            },
          ],
        },
        {
          id: "operational",
          title: "Operational region",
          description: "",
          items: [
            {
              id: "operational_region",
              kind: "dropdown",
              prompt: "Operational region",
              required: true,
              optionSource: "coordination_operational_regions",
              options: [],
            },
          ],
        },
        profileSection,
      ],
    };
    expect(operationalRegionPathsIncludeRegionGroup(regionContent)).toBe(true);
  });

  it("rejects a reachable branch that bypasses region group", () => {
    const unsafeContent: SurveyVersionContent = {
      ...content,
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
                {
                  id: "yes",
                  label: "Yes",
                  nextSectionId: "operational",
                },
                { id: "no", label: "No", nextSectionId: "profile" },
              ],
            },
          ],
        },
        {
          id: "region",
          title: "Region group",
          description: "",
          items: [
            {
              id: "region_group",
              kind: "dropdown",
              prompt: "Region group",
              required: true,
              optionSource: "coordination_region_groups",
              options: [],
            },
          ],
        },
        {
          id: "operational",
          title: "Operational region",
          description: "",
          items: [
            {
              id: "operational_region",
              kind: "dropdown",
              prompt: "Operational region",
              required: true,
              optionSource: "coordination_operational_regions",
              options: [],
            },
          ],
        },
        profileSection,
      ],
    };
    expect(operationalRegionPathsIncludeRegionGroup(unsafeContent)).toBe(false);
  });

  it("rejects a reachable terminal branch that bypasses operational region", () => {
    const unsafeContent: SurveyVersionContent = {
      ...content,
      sections: [
        {
          ...workSection,
          items: [
            {
              id: "works_in_region",
              kind: "single_choice",
              prompt: "Do you work in a region?",
              required: true,
              options: [
                { id: "yes", label: "Yes", nextSectionId: "operational" },
                { id: "no", label: "No", nextSectionId: "profile" },
              ],
            },
          ],
        },
        {
          id: "operational",
          title: "Operational region",
          description: "",
          items: [
            {
              id: "operational_region",
              kind: "dropdown",
              prompt: "Operational region",
              required: true,
              optionSource: "coordination_operational_regions",
              options: [],
            },
          ],
        },
        profileSection,
      ],
    };
    expect(allSurveyPathsIncludeOperationalRegion(unsafeContent)).toBe(false);
  });

  it("accepts branching when every terminal path includes operational region", () => {
    const safeContent: SurveyVersionContent = {
      ...content,
      sections: [
        {
          ...workSection,
          items: [
            {
              id: "works_in_region",
              kind: "single_choice",
              prompt: "Do you work in a region?",
              required: true,
              options: [
                { id: "yes", label: "Yes", nextSectionId: "operational" },
                { id: "no", label: "No", nextSectionId: "operational" },
              ],
            },
          ],
        },
        {
          id: "operational",
          title: "Operational region",
          description: "",
          items: [
            {
              id: "operational_region",
              kind: "dropdown",
              prompt: "Operational region",
              required: true,
              optionSource: "coordination_operational_regions",
              options: [],
            },
          ],
        },
        profileSection,
      ],
    };
    expect(allSurveyPathsIncludeOperationalRegion(safeContent)).toBe(true);
  });
});
