import { describe, expect, it } from "vitest";
import type { SurveyQuestion } from "#/features/survey/survey.schema";
import { validateAnswer } from "./learner-survey.server";

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
    expect(result(number, 8).valid).toBe(true);
    expect(result(date, "2027-01-01").valid).toBe(false);
    expect(result(date, "2026-06-30").valid).toBe(true);
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
});
