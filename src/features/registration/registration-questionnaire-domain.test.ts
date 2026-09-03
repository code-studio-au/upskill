import { describe, expect, it } from "vitest";
import {
  OPERATIONAL_REGION_OPTION_SOURCE,
  REGION_GROUP_OPTION_SOURCE,
  type SurveyVersionContent,
} from "#/features/survey/survey.schema";
import { allSurveyPathsIncludeOperationalRegion } from "#/features/survey/survey-branching";
import {
  filterRegistrationEventRegionOptions,
  registrationAnswerText,
  registrationOffersProfileUpdate,
  registrationQuestions,
  withoutRegistrationAnswer,
} from "./registration-questionnaire-domain";

const content: SurveyVersionContent = {
  title: "Registration details",
  description: "",
  sections: [
    {
      id: "section_details",
      title: "Details",
      description: "",
      items: [
        {
          id: "instructions",
          kind: "instruction",
          title: "Privacy",
          body: "These answers apply to this registration.",
        },
        {
          id: "region_group",
          kind: "dropdown",
          prompt: "Region group",
          required: true,
          optionSource: REGION_GROUP_OPTION_SOURCE,
          options: [
            { id: "group_north", label: "North", externalValue: "north" },
            { id: "group_south", label: "South", externalValue: "south" },
          ],
        },
        {
          id: "operational_region",
          kind: "dropdown",
          prompt: "Operational region",
          required: true,
          optionSource: OPERATIONAL_REGION_OPTION_SOURCE,
          options: [
            {
              id: "region_north_one",
              label: "North One",
              externalValue: "north_one",
              parentExternalValue: "north",
            },
            {
              id: "region_south_one",
              label: "South One",
              externalValue: "south_one",
              parentExternalValue: "south",
            },
          ],
        },
        {
          id: "discipline",
          kind: "multiple_choice",
          prompt: "Disciplines",
          required: true,
          options: [
            { id: "nursing", label: "Nursing" },
            { id: "medicine", label: "Medicine" },
          ],
        },
      ],
    },
  ],
};

describe("registration questionnaire domain", () => {
  it("excludes instructions and detects profile-aware questions", () => {
    const questions = registrationQuestions(content);
    expect(questions.map((question) => question.id)).toEqual([
      "region_group",
      "operational_region",
      "discipline",
    ]);
    expect(registrationOffersProfileUpdate(content)).toBe(true);
    const discipline = questions.find(
      (question) => question.id === "discipline",
    );
    if (!discipline) throw new Error("Expected discipline fixture");
    expect(
      registrationOffersProfileUpdate({
        ...content,
        sections: [
          {
            id: "discipline_only",
            title: "Discipline",
            description: "",
            items: [discipline],
          },
        ],
      }),
    ).toBe(false);
  });

  it("limits an Event to offered regions and their parent groups", () => {
    const filtered = filterRegistrationEventRegionOptions(
      content,
      new Set(["north_one"]),
    );
    const questions = registrationQuestions(filtered);
    expect(
      questions.find((question) => question.id === "region_group"),
    ).toMatchObject({ options: [{ id: "group_north" }] });
    expect(
      questions.find((question) => question.id === "operational_region"),
    ).toMatchObject({ options: [{ id: "region_north_one" }] });
  });

  it("removes unreachable region branches before publication validation", () => {
    const branchingContent: SurveyVersionContent = {
      ...content,
      sections: [
        {
          id: "region_group_section",
          title: "Region group",
          description: "",
          items: [
            {
              id: "region_group",
              kind: "dropdown",
              prompt: "Region group",
              required: true,
              optionSource: REGION_GROUP_OPTION_SOURCE,
              options: [
                {
                  id: "group_north",
                  label: "North",
                  externalValue: "north",
                  nextSectionId: "operational_region_section",
                },
                {
                  id: "group_south",
                  label: "South",
                  externalValue: "south",
                  nextSectionId: "profile_section",
                },
              ],
            },
          ],
        },
        {
          id: "operational_region_section",
          title: "Operational region",
          description: "",
          items: [
            {
              id: "operational_region",
              kind: "dropdown",
              prompt: "Operational region",
              required: true,
              optionSource: OPERATIONAL_REGION_OPTION_SOURCE,
              options: [
                {
                  id: "region_north_one",
                  label: "North One",
                  externalValue: "north_one",
                  parentExternalValue: "north",
                },
                {
                  id: "region_south_one",
                  label: "South One",
                  externalValue: "south_one",
                  parentExternalValue: "south",
                },
              ],
            },
          ],
        },
        {
          id: "profile_section",
          title: "Profile",
          description: "",
          items: [
            {
              id: "discipline",
              kind: "short_text",
              prompt: "Discipline",
              required: false,
              maximumLength: 200,
              format: "plain",
            },
          ],
        },
      ],
    };
    expect(allSurveyPathsIncludeOperationalRegion(branchingContent)).toBe(
      false,
    );
    expect(
      allSurveyPathsIncludeOperationalRegion(
        filterRegistrationEventRegionOptions(
          branchingContent,
          new Set(["north_one"]),
        ),
      ),
    ).toBe(true);
  });

  it("removes stale branch answers without mutating the source", () => {
    const answers = { region_group: "group_north", discipline: ["nursing"] };
    expect(withoutRegistrationAnswer(answers, "region_group")).toEqual({
      discipline: ["nursing"],
    });
    expect(answers).toHaveProperty("region_group", "group_north");
  });

  it("formats scalar and option answers for administrators", () => {
    const questions = registrationQuestions(content);
    const region = questions.find(
      (question) => question.id === "operational_region",
    );
    const disciplines = questions.find(
      (question) => question.id === "discipline",
    );
    if (!region || !disciplines)
      throw new Error("Expected answer-display fixtures");
    expect(registrationAnswerText(region, "region_north_one")).toBe(
      "North One",
    );
    expect(registrationAnswerText(region, "retired_option")).toBe(
      "retired_option",
    );
    expect(registrationAnswerText(disciplines, ["nursing", "missing"])).toBe(
      "Nursing, missing",
    );
    expect(registrationAnswerText(disciplines, true)).toBe("Yes");
    expect(registrationAnswerText(disciplines, false)).toBe("No");
    expect(registrationAnswerText(disciplines, 7)).toBe("7");
    const shortText = {
      id: "free_text",
      kind: "short_text" as const,
      prompt: "Other",
      required: false,
      maximumLength: 200,
      format: "plain" as const,
    };
    expect(registrationAnswerText(shortText, "Allied health")).toBe(
      "Allied health",
    );
    const date = {
      id: "available_from",
      kind: "date" as const,
      prompt: "Available from",
      required: false,
      minimum: null,
      maximum: null,
    };
    expect(registrationAnswerText(date, "2026-09-03")).toBe("3 Sept 2026");
  });
});
