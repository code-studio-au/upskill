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

export const REGION_GROUP_OPTION_SOURCE = "coordination_region_groups" as const;
export const OPERATIONAL_REGION_OPTION_SOURCE =
  "coordination_operational_regions" as const;
export type SurveyProfileField =
  "name" | "phone" | "emailEnabled" | "smsEnabled";

const surveyOptionSchema = z.object({
  id: identifierSchema,
  label: boundedText(240),
  externalValue: z.optional(optionalText(240)),
  parentExternalValue: z.optional(optionalText(240)),
  nextSectionId: z.optional(identifierSchema),
});

const questionBase = {
  id: identifierSchema,
  prompt: boundedText(500),
  required: z.boolean(),
  profileField: z.optional(
    z.enum(["name", "phone", "emailEnabled", "smsEnabled"]),
  ),
};

const optionQuestionBase = {
  ...questionBase,
  options: z.array(surveyOptionSchema).check(z.minLength(2), z.maxLength(500)),
};

const dropdownQuestionSchema = z.object({
  ...questionBase,
  kind: z.literal("dropdown"),
  optionSource: z.optional(
    z.enum([REGION_GROUP_OPTION_SOURCE, OPERATIONAL_REGION_OPTION_SOURCE]),
  ),
  options: z.array(surveyOptionSchema).check(z.maxLength(500)),
});

export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const dateOnlySchema = z
  .string()
  .check(z.refine(isCalendarDate, "Enter a valid date."));

const surveyQuestionSchema = z.discriminatedUnion("kind", [
  z.object({
    ...optionQuestionBase,
    kind: z.literal("single_choice"),
  }),
  z.object({
    ...optionQuestionBase,
    kind: z.literal("multiple_choice"),
  }),
  dropdownQuestionSchema,
  z.object({
    ...questionBase,
    kind: z.literal("short_text"),
    maximumLength: z.number().check(z.int(), z.minimum(1), z.maximum(500)),
    format: z.enum(["plain", "email", "phone", "url"]),
  }),
  z.object({
    ...questionBase,
    kind: z.literal("long_text"),
    maximumLength: z.number().check(z.int(), z.minimum(1), z.maximum(10_000)),
  }),
  z.object({
    ...questionBase,
    kind: z.literal("checkbox"),
  }),
  z.object({
    ...questionBase,
    kind: z.literal("number"),
    integer: z.boolean(),
    minimum: z.nullable(z.number()),
    maximum: z.nullable(z.number()),
  }),
  z.object({
    ...questionBase,
    kind: z.literal("date"),
    minimum: z.nullable(dateOnlySchema),
    maximum: z.nullable(dateOnlySchema),
  }),
  z.object({
    ...questionBase,
    kind: z.literal("rating"),
    minimum: z.number().check(z.int(), z.minimum(0), z.maximum(10)),
    maximum: z.number().check(z.int(), z.minimum(1), z.maximum(10)),
    minimumLabel: optionalText(120),
    maximumLabel: optionalText(120),
  }),
]);

const legacySurveyQuestionSchema = z.discriminatedUnion("kind", [
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
  questions: z.array(legacySurveyQuestionSchema).check(z.maxLength(100)),
});

const legacySectionSurveyContentSchema = z.object({
  title: boundedText(160),
  description: optionalText(2_000),
  sections: z.array(
    z.object({
      id: identifierSchema,
      title: boundedText(160),
      description: optionalText(2_000),
      items: z
        .array(z.union([legacySurveyQuestionSchema, surveyInstructionSchema]))
        .check(z.maxLength(100)),
    }),
  ),
});

export const surveyVersionContentSchema = z
  .object({
    title: boundedText(160),
    description: optionalText(2_000),
    sections: z.array(surveySectionSchema).check(z.maxLength(50)),
  })
  .check(
    z.superRefine((content, context) => {
      const sectionIndexes = new Map(
        content.sections.map((section, index) => [section.id, index] as const),
      );
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
          if (!("options" in item)) {
            if (
              (item.kind === "number" || item.kind === "date") &&
              item.minimum !== null &&
              item.maximum !== null &&
              item.minimum > item.maximum
            )
              context.addIssue({
                code: "custom",
                path: ["sections", sectionIndex, "items", itemIndex, "maximum"],
                message: "Maximum must not be less than minimum",
              });
            if (item.kind === "rating" && item.minimum >= item.maximum)
              context.addIssue({
                code: "custom",
                path: ["sections", sectionIndex, "items", itemIndex, "maximum"],
                message: "Rating maximum must be greater than minimum",
              });
            continue;
          }
          const optionIdentifiers = new Set<string>();
          if (
            item.kind === "dropdown" &&
            item.optionSource === undefined &&
            item.options.length < 2
          )
            context.addIssue({
              code: "custom",
              path: ["sections", sectionIndex, "items", itemIndex, "options"],
              message: "A dropdown question needs at least two options",
            });
          const labels = new Set<string>();
          const externalValues = new Set<string>();
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
            if (option.nextSectionId) {
              const targetIndex = sectionIndexes.get(option.nextSectionId);
              if (
                item.kind === "multiple_choice" ||
                targetIndex === undefined ||
                targetIndex <= sectionIndex
              )
                context.addIssue({
                  code: "custom",
                  path: [
                    "sections",
                    sectionIndex,
                    "items",
                    itemIndex,
                    "options",
                    optionIndex,
                    "nextSectionId",
                  ],
                  message:
                    "Conditional logic must continue at a later survey section",
                });
            }
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
            if (option.externalValue) {
              const normalizedExternalValue =
                option.externalValue.toLocaleLowerCase("en-AU");
              if (externalValues.has(normalizedExternalValue))
                context.addIssue({
                  code: "custom",
                  path: [
                    "sections",
                    sectionIndex,
                    "items",
                    itemIndex,
                    "options",
                    optionIndex,
                    "externalValue",
                  ],
                  message: "External values must be unique within a question",
                });
              externalValues.add(normalizedExternalValue);
            }
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
  const legacySections = legacySectionSurveyContentSchema.safeParse(value);
  if (legacySections.success)
    return surveyVersionContentSchema.parse({
      ...legacySections.data,
      sections: legacySections.data.sections.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          item.kind === "text" ? { ...item, kind: "long_text" as const } : item,
        ),
      })),
    });
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
        items: legacy.data.questions.map((question) =>
          question.kind === "text"
            ? { ...question, kind: "long_text" as const }
            : question,
        ),
      },
    ],
  });
}

export const adminSurveyCreateSchema = z.object({
  title: boundedText(160),
  usage: z.enum(["learning", "onboarding"]),
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
  z.string().check(z.maxLength(10_000)),
  z.array(identifierSchema).check(z.maxLength(500)),
  z.boolean(),
  z.number(),
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
export type SurveyOption = z.infer<typeof surveyOptionSchema>;
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
  usage: "learning" | "onboarding";
  draftVersion: number | null;
  publishedVersion: number | null;
  versions: Array<{
    id: string;
    version: number;
    publishedAt: string | null;
    courseUsages: Array<CourseVersionUsage>;
  }>;
}

export interface AdminSurveyDetail {
  survey: { id: string; title: string; usage: "learning" | "onboarding" };
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
  regionGroupOptions: Array<SurveyOption>;
  operationalRegionOptions: Array<SurveyOption>;
  draft: AdminSurveyDraft;
}

export function isRegionGroupQuestion(item: SurveyItem): item is Extract<
  SurveyQuestion,
  { kind: "dropdown" }
> & {
  optionSource: typeof REGION_GROUP_OPTION_SOURCE;
} {
  return (
    item.kind === "dropdown" && item.optionSource === REGION_GROUP_OPTION_SOURCE
  );
}

export function isOperationalRegionQuestion(item: SurveyItem): item is Extract<
  SurveyQuestion,
  { kind: "dropdown" }
> & {
  optionSource: typeof OPERATIONAL_REGION_OPTION_SOURCE;
} {
  return (
    item.kind === "dropdown" &&
    item.optionSource === OPERATIONAL_REGION_OPTION_SOURCE
  );
}

export function surveyProfileField(
  item: SurveyItem,
): SurveyProfileField | null {
  return item.kind === "instruction" ? null : (item.profileField ?? null);
}

export function applyRegionDirectoryOptions(
  content: SurveyVersionContent,
  options: {
    regionGroups: Array<SurveyOption>;
    operationalRegions: Array<SurveyOption>;
  },
): SurveyVersionContent {
  return {
    ...content,
    sections: content.sections.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        isRegionGroupQuestion(item)
          ? { ...item, options: options.regionGroups }
          : isOperationalRegionQuestion(item)
            ? { ...item, options: options.operationalRegions }
            : item,
      ),
    })),
  };
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
  accessMode?: "authenticated" | "event_task";
  recoveryPublicReference?: string | null;
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
