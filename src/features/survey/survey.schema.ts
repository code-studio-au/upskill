import { z } from "#/validation/zod";
import type { CourseVersionUsage } from "#/features/admin-course/course-version-usage";

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

const surveyInstructionSchema = z.object({
  id: identifierSchema,
  kind: z.literal("instruction"),
  title: boundedText(240),
  body: boundedText(10_000),
});

const surveyItemSchema = z.union([
  surveyQuestionSchema,
  surveyInstructionSchema,
]);

const surveySectionSchema = z.object({
  id: identifierSchema,
  title: boundedText(160),
  description: optionalText(2_000),
  items: z.array(surveyItemSchema).check(z.maxLength(100)),
});

const legacySurveyVersionContentSchema = z.object({
  title: boundedText(160),
  description: optionalText(2_000),
  questions: z.array(surveyQuestionSchema).check(z.maxLength(100)),
});

export const surveyVersionContentSchema = z
  .object({
    title: boundedText(160),
    description: optionalText(2_000),
    sections: z.array(surveySectionSchema).check(z.maxLength(50)),
  })
  .check(
    z.superRefine((content, context) => {
      const sectionIdentifiers = new Set<string>();
      const itemIdentifiers = new Set<string>();
      let itemCount = 0;
      for (const [sectionIndex, section] of content.sections.entries()) {
        if (sectionIdentifiers.has(section.id))
          context.addIssue({
            code: "custom",
            path: ["sections", sectionIndex, "id"],
            message: "Section identifiers must be unique",
          });
        sectionIdentifiers.add(section.id);
        itemCount += section.items.length;
        for (const [itemIndex, item] of section.items.entries()) {
          if (itemIdentifiers.has(item.id))
            context.addIssue({
              code: "custom",
              path: ["sections", sectionIndex, "items", itemIndex, "id"],
              message: "Item identifiers must be unique",
            });
          itemIdentifiers.add(item.id);
          if (item.kind === "instruction" || item.kind === "text") continue;
          const optionIdentifiers = new Set<string>();
          const labels = new Set<string>();
          for (const [optionIndex, option] of item.options.entries()) {
            if (optionIdentifiers.has(option.id))
              context.addIssue({
                code: "custom",
                path: [
                  "sections",
                  sectionIndex,
                  "items",
                  itemIndex,
                  "options",
                  optionIndex,
                  "id",
                ],
                message: "Option identifiers must be unique",
              });
            optionIdentifiers.add(option.id);
            const normalized = option.label.toLocaleLowerCase("en-AU");
            if (labels.has(normalized))
              context.addIssue({
                code: "custom",
                path: [
                  "sections",
                  sectionIndex,
                  "items",
                  itemIndex,
                  "options",
                  optionIndex,
                  "label",
                ],
                message: "Option labels must be unique within a question",
              });
            labels.add(normalized);
          }
        }
      }
      if (itemCount > 200)
        context.addIssue({
          code: "custom",
          path: ["sections"],
          message: "A survey may contain at most 200 items",
        });
    }),
  );

export function parseSurveyVersionContent(
  value: unknown,
): SurveyVersionContent {
  const current = surveyVersionContentSchema.safeParse(value);
  if (current.success) return current.data;
  const legacy = legacySurveyVersionContentSchema.safeParse(value);
  if (!legacy.success) return surveyVersionContentSchema.parse(value);
  return surveyVersionContentSchema.parse({
    title: legacy.data.title,
    description: legacy.data.description,
    sections: [
      {
        id: "section_legacy_questions",
        title: "Survey",
        description: "",
        items: legacy.data.questions,
      },
    ],
  });
}

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
    title: boundedText(160),
    description: optionalText(2_000),
    sections: z.array(surveySectionSchema).check(z.maxLength(50)),
    surveyId: identifierSchema,
    versionId: identifierSchema,
  })
  .check(
    z.refine(
      (draft) =>
        surveyVersionContentSchema.safeParse({
          title: draft.title,
          description: draft.description,
          sections: draft.sections,
        }).success,
      { message: "Review the survey sections and items" },
    ),
  );

const learnerSurveyParamsShape = {
  enrollmentId: identifierSchema,
  courseVersionItemId: identifierSchema,
};

export const learnerSurveyParamsSchema = z.object(learnerSurveyParamsShape);

export const learnerEventSurveyParamsSchema = z.object({
  eventOccurrenceId: identifierSchema,
  eventTemplateVersionItemId: identifierSchema,
});

export const surveyAnswerValueSchema = z.union([
  z.string().check(z.maxLength(2_000)),
  z.array(identifierSchema).check(z.maxLength(20)),
]);

export const learnerEventSurveyStepSchema = z.object({
  eventParticipationId: identifierSchema,
  eventTemplateVersionItemId: identifierSchema,
  itemId: identifierSchema,
  answer: z.optional(surveyAnswerValueSchema),
});

export const learnerSurveyStepSchema = z.object({
  ...learnerSurveyParamsShape,
  itemId: identifierSchema,
  answer: z.optional(surveyAnswerValueSchema),
});

export type SurveyQuestion = z.infer<typeof surveyQuestionSchema>;
export type SurveyItem = z.infer<typeof surveyItemSchema>;
export type SurveySection = z.infer<typeof surveySectionSchema>;
export type SurveyVersionContent = z.infer<typeof surveyVersionContentSchema>;
export type AdminSurveyDraft = z.infer<typeof adminSurveyDraftSchema>;
export type SurveyAnswerValue = z.infer<typeof surveyAnswerValueSchema>;
export type LearnerSurveyStep = z.infer<typeof learnerSurveyStepSchema>;
export type LearnerEventSurveyStep = z.infer<
  typeof learnerEventSurveyStepSchema
>;

export interface AdminSurveySummary {
  id: string;
  title: string;
  latestVersion: number;
  draftVersion: number | null;
  publishedVersions: number;
  versions: Array<{
    id: string;
    version: number;
    publishedAt: string | null;
    courseUsages: Array<CourseVersionUsage>;
  }>;
}

export interface AdminSurveyDetail {
  survey: { id: string; title: string };
  version: {
    id: string;
    version: number;
    publishedAt: string | null;
    editable: boolean;
    courseUsages: Array<CourseVersionUsage>;
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

interface SurveySectionProgress {
  id: string;
  completedItems: number;
  totalItems: number;
  percent: number;
  completed: boolean;
}

export interface LearnerSurveyProgress {
  answers: Record<string, SurveyAnswerValue>;
  visitedItemIds: Array<string>;
  currentItemId: string | null;
  completedAt: string | null;
  completedItems: number;
  totalItems: number;
  percent: number;
  sections: Array<SurveySectionProgress>;
}

export interface LearnerSurvey {
  enrollmentId: string;
  courseVersionItemId: string;
  courseTitle: string;
  sectionTitle: string;
  surveyVersionId: string;
  content: SurveyVersionContent;
  progress: LearnerSurveyProgress;
  submittedAt: string | null;
}

export interface LearnerEventSurvey {
  eventOccurrenceId: string;
  eventParticipationId: string;
  eventTemplateVersionItemId: string;
  eventTitle: string;
  sectionTitle: string;
  surveyVersionId: string;
  content: SurveyVersionContent;
  progress: LearnerSurveyProgress;
  submittedAt: string | null;
}

export type LearnerSurveyResult =
  | { status: "ready"; data: LearnerSurvey }
  | { status: "not-found" }
  | { status: "unavailable" }
  | { status: "unauthenticated" };

export type LearnerSurveyStepResult =
  | {
      status: "advanced" | "submitted";
      progress: LearnerSurveyProgress;
      completedCourse: boolean;
    }
  | { status: "invalid"; message: string }
  | { status: "not-found" }
  | { status: "unavailable" }
  | { status: "unauthenticated" };
