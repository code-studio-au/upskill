import { z } from "#/validation/zod";

const identifierSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_-]+$/),
  );
const boundedText = (maximum: number) =>
  z.string().check(z.trim(), z.minLength(1), z.maxLength(maximum));
const optionalText = (maximum: number) =>
  z.string().check(z.trim(), z.maxLength(maximum));

const surveyOptionSchema = z.object({
  id: identifierSchema,
  label: boundedText(240),
});

const questionBase = {
  id: identifierSchema,
  prompt: boundedText(500),
  required: z.boolean(),
};

const surveyQuestionSchema = z.discriminatedUnion("kind", [
  z.object({
    ...questionBase,
    kind: z.literal("single_choice"),
    options: z.array(surveyOptionSchema).check(z.minLength(2), z.maxLength(20)),
  }),
  z.object({
    ...questionBase,
    kind: z.literal("multiple_choice"),
    options: z.array(surveyOptionSchema).check(z.minLength(2), z.maxLength(20)),
  }),
  z.object({
    ...questionBase,
    kind: z.literal("text"),
    maximumLength: z.number().check(z.int(), z.minimum(1), z.maximum(2_000)),
  }),
]);

const surveyVersionContentShape = {
  title: boundedText(160),
  description: optionalText(2_000),
  questions: z.array(surveyQuestionSchema).check(z.maxLength(100)),
};

export const surveyVersionContentSchema = z
  .object(surveyVersionContentShape)
  .check(
    z.superRefine((content, context) => {
      const identifiers = new Set<string>();
      for (const [questionIndex, question] of content.questions.entries()) {
        if (identifiers.has(question.id))
          context.addIssue({
            code: "custom",
            path: ["questions", questionIndex, "id"],
            message: "Question identifiers must be unique",
          });
        identifiers.add(question.id);
        if (question.kind === "text") continue;
        const labels = new Set<string>();
        for (const [optionIndex, option] of question.options.entries()) {
          if (identifiers.has(option.id))
            context.addIssue({
              code: "custom",
              path: ["questions", questionIndex, "options", optionIndex, "id"],
              message: "Option identifiers must be unique",
            });
          identifiers.add(option.id);
          const normalized = option.label.toLocaleLowerCase("en-AU");
          if (labels.has(normalized))
            context.addIssue({
              code: "custom",
              path: [
                "questions",
                questionIndex,
                "options",
                optionIndex,
                "label",
              ],
              message: "Option labels must be unique within a question",
            });
          labels.add(normalized);
        }
      }
    }),
  );

export const adminSurveyCreateSchema = z.object({
  title: boundedText(160),
});

export const adminSurveyParamsSchema = z.object({ surveyId: identifierSchema });

export const adminSurveyVersionParamsSchema = z.object({
  surveyId: identifierSchema,
  versionId: identifierSchema,
});

export const adminSurveyDraftSchema = z
  .object({
    ...surveyVersionContentShape,
    surveyId: identifierSchema,
    versionId: identifierSchema,
  })
  .check(
    z.refine(
      (draft) =>
        surveyVersionContentSchema.safeParse({
          title: draft.title,
          description: draft.description,
          questions: draft.questions,
        }).success,
      { message: "Review the survey questions and options" },
    ),
  );

const learnerSurveyParamsShape = {
  enrollmentId: identifierSchema,
  courseVersionItemId: identifierSchema,
};

export const learnerSurveyParamsSchema = z.object(learnerSurveyParamsShape);

const surveyAnswerSchema = z.object({
  questionId: identifierSchema,
  value: z.union([
    z.string().check(z.maxLength(2_000)),
    z.array(identifierSchema).check(z.maxLength(20)),
  ]),
});

export const learnerSurveySubmissionSchema = z
  .object({
    ...learnerSurveyParamsShape,
    answers: z.array(surveyAnswerSchema).check(z.maxLength(100)),
  })
  .check(
    z.superRefine((submission, context) => {
      const seen = new Set<string>();
      for (const [index, answer] of submission.answers.entries()) {
        if (seen.has(answer.questionId))
          context.addIssue({
            code: "custom",
            path: ["answers", index, "questionId"],
            message: "Each question may be answered once",
          });
        seen.add(answer.questionId);
      }
    }),
  );

export type SurveyQuestion = z.infer<typeof surveyQuestionSchema>;
export type SurveyVersionContent = z.infer<typeof surveyVersionContentSchema>;
export type AdminSurveyDraft = z.infer<typeof adminSurveyDraftSchema>;
export type LearnerSurveySubmission = z.infer<
  typeof learnerSurveySubmissionSchema
>;

export interface AdminSurveySummary {
  id: string;
  title: string;
  latestVersion: number;
  draftVersion: number | null;
  publishedVersions: number;
}

export interface AdminSurveyDetail {
  survey: { id: string; title: string };
  version: {
    id: string;
    version: number;
    publishedAt: string | null;
    editable: boolean;
  };
  versions: Array<{
    id: string;
    version: number;
    publishedAt: string | null;
  }>;
  draft: AdminSurveyDraft;
}

export type AdminSurveyResult<T> =
  | { status: "ready"; data: T }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export type AdminSurveyDetailResult =
  AdminSurveyResult<AdminSurveyDetail> | { status: "not-found" };

export type AdminSurveyMutationResult =
  | AdminSurveyResult<{
      outcome: "created" | "saved" | "published";
      surveyId: string;
      versionId?: string;
    }>
  | { status: "not-found" }
  | { status: "conflict"; reason: string };

export interface LearnerSurvey {
  enrollmentId: string;
  courseVersionItemId: string;
  courseTitle: string;
  sectionTitle: string;
  surveyVersionId: string;
  content: SurveyVersionContent;
  submittedAt: string | null;
}

export type LearnerSurveyResult =
  | { status: "ready"; data: LearnerSurvey }
  | { status: "not-found" }
  | { status: "unavailable" }
  | { status: "unauthenticated" };

export type LearnerSurveySubmissionResult =
  | { status: "submitted"; completedCourse: boolean }
  | { status: "invalid"; message: string }
  | { status: "not-found" }
  | { status: "unavailable" }
  | { status: "unauthenticated" };
