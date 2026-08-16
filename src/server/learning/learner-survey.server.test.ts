import { describe, expect, it } from "vitest";
import type { SurveyQuestion } from "#/features/survey/survey.schema";
import { validateAnswer } from "./survey-answer-validation";

const base = { id: "question", prompt: "Question", required: true };

function result(
  question: SurveyQuestion,
  answer: string | number | boolean | Array<string> | undefined,
) {
  return validateAnswer(question, answer);
}

describe("survey answer validation", () => {
  it("requires explicit acknowledgement", () => {
    const question: SurveyQuestion = { ...base, kind: "checkbox" };
    expect(result(question, false).valid).toBe(false);
    expect(result(question, true)).toEqual({ valid: true, answer: true });
  });

  it("validates typed short text formats", () => {
    const question: SurveyQuestion = {
      ...base,
      kind: "short_text",
      maximumLength: 240,
      format: "email",
    };
    expect(result(question, "not-an-email").valid).toBe(false);
    expect(result(question, "learner@example.com")).toEqual({
      valid: true,
      answer: "learner@example.com",
    });
  });

  it("validates optional text and URL or phone formats", () => {
    const optional: SurveyQuestion = {
      ...base,
      required: false,
      kind: "short_text",
      maximumLength: 10,
      format: "plain",
    };
    expect(result(optional, undefined)).toEqual({ valid: true });
    expect(result(optional, "   ")).toEqual({ valid: true });
    expect(result(optional, "more than ten").valid).toBe(false);

    const url: SurveyQuestion = {
      ...optional,
      required: true,
      maximumLength: 240,
      format: "url",
    };
    expect(result(url, "not a url").valid).toBe(false);
    expect(result(url, "https://example.com").valid).toBe(true);

    const phone: SurveyQuestion = {
      ...optional,
      required: true,
      maximumLength: 40,
      format: "phone",
    };
    expect(result(phone, "invalid").valid).toBe(false);
    expect(result(phone, "+61 400 000 000").valid).toBe(true);
  });

  it("enforces number, date and rating bounds", () => {
    const number: SurveyQuestion = {
      ...base,
      kind: "number",
      integer: true,
      minimum: 1,
      maximum: 10,
    };
    const date: SurveyQuestion = {
      ...base,
      kind: "date",
      minimum: "2026-01-01",
      maximum: "2026-12-31",
    };
    const rating: SurveyQuestion = {
      ...base,
      kind: "rating",
      minimum: 1,
      maximum: 5,
      minimumLabel: "Low",
      maximumLabel: "High",
    };
    expect(result(number, 2.5).valid).toBe(false);
    expect(result(number, undefined).valid).toBe(false);
    expect(result({ ...number, required: false }, undefined)).toEqual({
      valid: true,
    });
    expect(result(number, Number.POSITIVE_INFINITY).valid).toBe(false);
    expect(result(number, 8).valid).toBe(true);
    expect(result(date, "2027-01-01").valid).toBe(false);
    expect(result(date, "not-a-date").valid).toBe(false);
    expect(result(date, "2026-02-31").valid).toBe(false);
    expect(result(date, "2026-99-99").valid).toBe(false);
    expect(result(date, "2026-06-30").valid).toBe(true);
    expect(
      result({ ...date, minimum: null, maximum: null }, "2028-02-29").valid,
    ).toBe(true);
    expect(result(rating, 6).valid).toBe(false);
    expect(result(rating, 4).valid).toBe(true);
  });

  it("accepts only immutable dropdown option identifiers", () => {
    const question: SurveyQuestion = {
      ...base,
      kind: "dropdown",
      options: [
        { id: "region_one", label: "Region one" },
        { id: "region_two", label: "Region two" },
      ],
    };
    expect(result(question, "Region one").valid).toBe(false);
    expect(result(question, "region_one")).toEqual({
      valid: true,
      answer: "region_one",
    });
  });

  it("validates single and multiple choice answers", () => {
    const options = [
      { id: "one", label: "One" },
      { id: "two", label: "Two" },
    ];
    const single: SurveyQuestion = {
      ...base,
      kind: "single_choice",
      options,
    };
    expect(result(single, undefined).valid).toBe(false);
    expect(result(single, "one")).toEqual({ valid: true, answer: "one" });

    const multiple: SurveyQuestion = {
      ...base,
      kind: "multiple_choice",
      options,
    };
    expect(result(multiple, "one").valid).toBe(false);
    expect(result(multiple, ["unknown"]).valid).toBe(false);
    expect(result(multiple, []).valid).toBe(false);
    expect(result(multiple, ["one", "one"])).toEqual({
      valid: true,
      answer: ["one"],
    });
    expect(result({ ...multiple, required: false }, [])).toEqual({
      valid: true,
    });
  });

  it("handles optional acknowledgement answers", () => {
    const optional: SurveyQuestion = {
      ...base,
      required: false,
      kind: "checkbox",
    };
    expect(result(optional, false)).toEqual({ valid: true, answer: false });
    expect(result(optional, undefined)).toEqual({ valid: true });
  });
});
