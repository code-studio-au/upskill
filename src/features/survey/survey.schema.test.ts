import { describe, expect, it } from "vitest";
import {
  learnerSurveyStepSchema,
  parseSurveyVersionContent,
  surveyVersionContentSchema,
} from "./survey.schema";

describe("survey contracts", () => {
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
