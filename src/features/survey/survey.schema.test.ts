import { describe, expect, it } from "vitest";
import {
  adminSurveyCreateSchema,
  adminSurveyMoveSchema,
  learnerSurveyStepSchema,
  parseSurveyVersionContent,
  surveyVersionContentSchema,
} from "./survey.schema";

describe("survey contracts", () => {
  it("accepts only the governed survey catalogue types and move directions", () => {
    for (const type of ["system", "elearning", "event", "shared"])
      expect(
        adminSurveyCreateSchema.safeParse({ title: "Feedback", type }).success,
      ).toBe(true);
    expect(
      adminSurveyCreateSchema.safeParse({
        title: "Feedback",
        type: "learning",
      }).success,
    ).toBe(false);
    expect(
      adminSurveyMoveSchema.safeParse({
        surveyId: "survey_1",
        direction: "up",
      }).success,
    ).toBe(true);
    expect(
      adminSurveyMoveSchema.safeParse({
        surveyId: "survey_1",
        direction: "sideways",
      }).success,
    ).toBe(false);
  });

  it("accepts ordered sections with questions and instruction blocks", () => {
    expect(
      surveyVersionContentSchema.safeParse({
        title: "Feedback",
        description: "Tell us what you thought.",
        sections: [
          {
            id: "section_1",
            title: "Before you begin",
            description: "",
            items: [
              {
                id: "instruction_1",
                kind: "instruction",
                title: "Privacy notice",
                body: "Please do not include personal information.",
              },
              {
                id: "question_1",
                kind: "single_choice",
                prompt: "Was this useful?",
                required: true,
                options: [
                  { id: "yes", label: "Yes" },
                  { id: "no", label: "No" },
                ],
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("normalizes legacy flat surveys into one stable section", () => {
    const content = parseSurveyVersionContent({
      title: "Legacy survey",
      description: "",
      questions: [
        {
          id: "question_1",
          kind: "text",
          prompt: "Comment",
          required: false,
          maximumLength: 200,
        },
      ],
    });
    expect(content.sections).toHaveLength(1);
    expect(content.sections[0]?.id).toBe("section_legacy_questions");
    expect(content.sections[0]?.items[0]?.id).toBe("question_1");
    expect(content.sections[0]?.items[0]?.kind).toBe("long_text");
  });

  it("accepts the standard onboarding question types and bulk option scale", () => {
    const common = { prompt: "Question", required: true };
    const items = [
      {
        id: "short",
        kind: "short_text",
        ...common,
        maximumLength: 240,
        format: "email",
      },
      { id: "long", kind: "long_text", ...common, maximumLength: 2_000 },
      {
        id: "dropdown",
        kind: "dropdown",
        ...common,
        options: [
          { id: "one", label: "One", externalValue: "region_one" },
          { id: "two", label: "Two", externalValue: "region_two" },
        ],
      },
      { id: "checkbox", kind: "checkbox", ...common },
      {
        id: "number",
        kind: "number",
        ...common,
        integer: true,
        minimum: 0,
        maximum: 100,
      },
      {
        id: "date",
        kind: "date",
        ...common,
        minimum: "2020-01-01",
        maximum: null,
      },
      {
        id: "rating",
        kind: "rating",
        ...common,
        minimum: 1,
        maximum: 5,
        minimumLabel: "Low",
        maximumLabel: "High",
      },
    ];
    expect(
      surveyVersionContentSchema.safeParse({
        title: "Onboarding",
        description: "",
        sections: [{ id: "profile", title: "Profile", description: "", items }],
      }).success,
    ).toBe(true);
  });

  it("accepts one locked question for each profile field", () => {
    expect(
      surveyVersionContentSchema.safeParse({
        title: "Profile",
        description: "",
        sections: [
          {
            id: "profile",
            title: "Profile",
            description: "",
            items: [
              {
                id: "name",
                kind: "short_text",
                prompt: "Full name",
                required: true,
                maximumLength: 160,
                format: "plain",
                profileField: "name",
              },
              {
                id: "phone",
                kind: "short_text",
                prompt: "Mobile phone number",
                required: true,
                maximumLength: 32,
                format: "phone",
                profileField: "phone",
              },
              {
                id: "email_enabled",
                kind: "checkbox",
                prompt: "Enable email",
                required: false,
                profileField: "emailEnabled",
              },
              {
                id: "sms_enabled",
                kind: "checkbox",
                prompt: "Enable SMS",
                required: false,
                profileField: "smsEnabled",
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("retains profile metadata for server-side usage validation", () => {
    const item = {
      kind: "short_text",
      prompt: "Mobile phone number",
      required: false,
      maximumLength: 32,
      format: "plain",
      profileField: "phone",
    } as const;
    const parsed = surveyVersionContentSchema.safeParse({
      title: "Profile",
      description: "",
      sections: [
        {
          id: "profile",
          title: "Profile",
          description: "",
          items: [
            { ...item, id: "phone_1" },
            { ...item, id: "phone_2" },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(parsed.data.sections[0]?.items[0]).toMatchObject({
        profileField: "phone",
      });
  });

  it("accepts locked region directory questions and their parent relationship", () => {
    const parsed = surveyVersionContentSchema.safeParse({
      title: "Onboarding",
      description: "",
      sections: [
        {
          id: "profile",
          title: "Profile",
          description: "",
          items: [
            {
              id: "group",
              kind: "dropdown",
              optionSource: "coordination_region_groups",
              prompt: "Region group",
              required: true,
              options: [
                {
                  id: "group_nsw",
                  label: "NSW Health (NSW-HEALTH)",
                  externalValue: "group_nsw",
                },
              ],
            },
            {
              id: "region",
              kind: "dropdown",
              optionSource: "coordination_operational_regions",
              prompt: "Operational region",
              required: true,
              options: [
                {
                  id: "region_slhd",
                  label: "Sydney Local Health District (SLHD)",
                  externalValue: "region_slhd",
                  parentExternalValue: "group_nsw",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects impossible calendar-date bounds", () => {
    expect(
      surveyVersionContentSchema.safeParse({
        title: "Dates",
        description: "",
        sections: [
          {
            id: "dates",
            title: "Dates",
            description: "",
            items: [
              {
                id: "date",
                kind: "date",
                prompt: "Choose a date",
                required: true,
                minimum: "2026-02-31",
                maximum: null,
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate item identifiers across sections", () => {
    expect(
      surveyVersionContentSchema.safeParse({
        title: "Feedback",
        description: "",
        sections: [
          {
            id: "section_1",
            title: "One",
            description: "",
            items: [
              {
                id: "duplicate",
                kind: "instruction",
                title: "First",
                body: "First block",
              },
            ],
          },
          {
            id: "section_2",
            title: "Two",
            description: "",
            items: [
              {
                id: "duplicate",
                kind: "instruction",
                title: "Second",
                body: "Second block",
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts forward answer branches to existing later sections", () => {
    expect(
      surveyVersionContentSchema.safeParse({
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
            items: [],
          },
          {
            id: "profile",
            title: "Profile",
            description: "",
            items: [],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects missing, backward and multiple-choice branch targets", () => {
    const sections = [
      {
        id: "first",
        title: "First",
        description: "",
        items: [],
      },
      {
        id: "second",
        title: "Second",
        description: "",
        items: [
          {
            id: "invalid_branch",
            kind: "multiple_choice",
            prompt: "Choose",
            required: true,
            options: [
              { id: "one", label: "One", nextSectionId: "first" },
              { id: "two", label: "Two", nextSectionId: "missing" },
            ],
          },
        ],
      },
    ];
    expect(
      surveyVersionContentSchema.safeParse({
        title: "Invalid branching",
        description: "",
        sections,
      }).success,
    ).toBe(false);
  });

  it("accepts one bounded learner step answer", () => {
    expect(
      learnerSurveyStepSchema.safeParse({
        enrollmentId: "enrollment_1",
        courseVersionItemId: "item_1",
        itemId: "question_1",
        answer: "yes",
      }).success,
    ).toBe(true);
  });
});
