import { z } from "#/validation/zod";
import type {
  LearnerSurveyProgress,
  SurveyVersionContent,
} from "#/features/survey/survey.schema";

const identifier = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_-]+$/u),
  );

const registrationAnswerValueSchema = z.union([
  z.string().check(z.maxLength(10_000)),
  z.array(identifier).check(z.maxLength(500)),
  z.boolean(),
  z.number(),
]);

export const registrationQuestionnaireStepSchema = z.object({
  assignmentId: identifier,
  itemId: identifier,
  answer: z.optional(registrationAnswerValueSchema),
  profileUpdateAccepted: z.optional(z.boolean()),
});

export interface LearnerRegistrationQuestionnaire {
  assignmentId: string;
  target:
    | { kind: "event"; eventOccurrenceId: string }
    | { kind: "course"; enrollmentId: string };
  offeringTitle: string;
  sectionTitle: string;
  surveyVersionId: string;
  content: SurveyVersionContent;
  progress: LearnerSurveyProgress;
  submittedAt: string | null;
  profileUpdateOffered: boolean;
}

export type LearnerRegistrationQuestionnaireStepResult =
  | {
      status: "advanced" | "submitted";
      progress: LearnerSurveyProgress;
      completedCourse: false;
    }
  | { status: "invalid"; message: string }
  | { status: "not-found" | "unavailable" | "unauthenticated" };
