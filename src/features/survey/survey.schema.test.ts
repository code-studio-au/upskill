import { describe, expect, it } from "vitest";
import {
  learnerSurveySubmissionSchema,
  surveyVersionContentSchema,
} from "./survey.schema";

describe("survey contracts", () => {
  it("accepts versioned question types with stable identifiers", () => {
    expect(
      surveyVersionContentSchema.safeParse({
        title: "Feedback",
        description: "Tell us what you thought.",
        questions: [
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
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate answer entries", () => {
    expect(
      learnerSurveySubmissionSchema.safeParse({
        enrollmentId: "enrollment_1",
        courseVersionItemId: "item_1",
        answers: [
          { questionId: "question_1", value: "yes" },
          { questionId: "question_1", value: "no" },
        ],
      }).success,
    ).toBe(false);
  });
});
