import { describe, expect, it } from "vitest";
import { registrationQuestionnaireStepSchema } from "./registration-questionnaire.schema";
import {
  registrationQuestionnaireAdminTargetSchema,
  registrationQuestionnaireWaiverSchema,
} from "./admin-registration-questionnaire.schema";

describe("registration questionnaire inputs", () => {
  it("accepts typed answers and rejects malformed identifiers", () => {
    expect(
      registrationQuestionnaireStepSchema.parse({
        assignmentId: "assignment_1",
        itemId: "question_1",
        answer: ["option_1", "option_2"],
        profileUpdateAccepted: true,
      }),
    ).toMatchObject({ answer: ["option_1", "option_2"] });
    expect(() =>
      registrationQuestionnaireStepSchema.parse({
        assignmentId: "../assignment",
        itemId: "question_1",
      }),
    ).toThrow();
  });

  it("requires a meaningful reason for an administrative waiver", () => {
    expect(
      registrationQuestionnaireAdminTargetSchema.parse({
        kind: "course",
        courseId: "course_1",
        enrollmentId: "enrollment_1",
      }),
    ).toMatchObject({ kind: "course", courseId: "course_1" });
    expect(() =>
      registrationQuestionnaireWaiverSchema.parse({
        target: {
          kind: "event",
          eventOccurrenceId: "occurrence_1",
          registrationId: "registration_1",
        },
        reason: " ",
      }),
    ).toThrow();
  });
});
