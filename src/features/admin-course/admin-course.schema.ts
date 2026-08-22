import { z } from "#/validation/zod";
import type { AdminCourseResourceOption } from "#/features/resource/resource.schema";
import {
  courseScheduleEmailItemSchema,
  type AdminCommunicationTemplateOption,
} from "#/features/admin-email/admin-communication.schema";
import type { EmailTemplateVariableGroup } from "#/features/admin-email/admin-email.schema";
import { certificateAccreditationsSchema } from "#/features/catalog/accreditation";
import { offeringTopicSchema } from "#/features/shared/offering-topic";
import { offeringImageSchema } from "#/features/shared/offering-image";

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
const moneySchema = z
  .number()
  .check(z.int(), z.nonnegative(), z.maximum(100_000_000));
const durationSchema = z
  .number()
  .check(z.int(), z.positive(), z.maximum(100_000));
const bulkPriceTierSchema = z.object({
  minimumQuantity: z.number().check(z.int(), z.minimum(2), z.maximum(100_000)),
  unitPriceCents: moneySchema.check(z.positive()),
});

export const adminCourseParamsSchema = z.object({
  courseId: identifierSchema,
});

export const adminCourseSelectionSchema = z.object({
  courseId: identifierSchema,
  courseVersionId: z.optional(identifierSchema),
});

export const adminCourseVersionParamsSchema = z.object({
  courseId: identifierSchema,
  versionId: identifierSchema,
});

export const adminCourseEnrollmentCreateSchema = z.object({
  courseId: identifierSchema,
  courseVersionId: identifierSchema,
  learnerEmail: z.pipe(
    z
      .string()
      .check(
        z.trim(),
        z.minLength(1, "Enter the learner's email address."),
        z.maxLength(320),
      ),
    z.email("Enter a valid learner email address."),
  ),
});

export const adminCourseEnrollmentRemoveSchema = z.object({
  courseId: identifierSchema,
  enrollmentId: identifierSchema,
});

export const adminCourseRosterSearchSchema = z.object({
  courseId: identifierSchema,
  q: z.catch(z.string().check(z.trim(), z.maxLength(100)), ""),
  page: z.catch(
    z.coerce.number().check(z.int(), z.minimum(1), z.maximum(100_000)),
    1,
  ),
});

const adminCourseCreateSchema = z.object({
  title: boundedText(160),
  slug: z
    .string()
    .check(
      z.trim(),
      z.minLength(1),
      z.maxLength(100),
      z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    ),
});

const itemBase = {
  id: identifierSchema,
  title: boundedText(200),
  required: z.boolean(),
};

const adminCourseItemSchema = z.discriminatedUnion("kind", [
  z.object({
    ...itemBase,
    kind: z.literal("scorm"),
    durationMinutes: durationSchema,
    scormPackageVersionId: identifierSchema,
  }),
  z.object({
    ...itemBase,
    kind: z.literal("survey"),
    durationMinutes: z.nullable(durationSchema),
    surveyVersionId: identifierSchema,
  }),
  z.object({
    ...itemBase,
    kind: z.literal("resource"),
    durationMinutes: z.null(),
    resourceVersionId: identifierSchema,
  }),
  courseScheduleEmailItemSchema,
]);

const adminCourseSectionSchema = z.object({
  id: identifierSchema,
  title: boundedText(160),
  description: optionalText(2_000),
  items: z.array(adminCourseItemSchema).check(z.maxLength(200)),
});

export const adminCourseDraftSchema = z
  .object({
    courseId: identifierSchema,
    versionId: identifierSchema,
    slug: adminCourseCreateSchema.shape.slug,
    title: boundedText(160),
    summary: boundedText(320),
    description: boundedText(10_000),
    topic: offeringTopicSchema,
    durationMinutes: durationSchema,
    priceCents: moneySchema,
    salePriceCents: z.nullable(moneySchema),
    bulkPricing: z.object({
      enabled: z.boolean(),
      tiers: z.array(bulkPriceTierSchema).check(z.maxLength(20)),
    }),
    featured: z.boolean(),
    listInStore: z.boolean(),
    coverImage: z._default(offeringImageSchema, null),
    hasCompletionCertificate: z.boolean(),
    prerequisites: z.array(boundedText(240)).check(z.maxLength(20)),
    accreditations: certificateAccreditationsSchema,
    sections: z.array(adminCourseSectionSchema).check(z.maxLength(100)),
  })
  .check(
    z.superRefine((draft, context) => {
      if (
        draft.salePriceCents !== null &&
        draft.salePriceCents >= draft.priceCents
      )
        context.addIssue({
          code: "custom",
          path: ["salePriceCents"],
          message: "Sale price must be lower than the standard price",
        });
      if (draft.bulkPricing.enabled && draft.bulkPricing.tiers.length === 0)
        context.addIssue({
          code: "custom",
          path: ["bulkPricing", "tiers"],
          message: "Add at least one bulk-pricing tier",
        });
      const individualPrice = draft.salePriceCents ?? draft.priceCents;
      let previousQuantity = 1;
      let previousPrice = individualPrice;
      for (const [index, tier] of draft.bulkPricing.tiers.entries()) {
        if (tier.minimumQuantity <= previousQuantity)
          context.addIssue({
            code: "custom",
            path: ["bulkPricing", "tiers", index, "minimumQuantity"],
            message: "Bulk-pricing quantities must increase",
          });
        if (tier.unitPriceCents >= previousPrice)
          context.addIssue({
            code: "custom",
            path: ["bulkPricing", "tiers", index, "unitPriceCents"],
            message: "Each tier must reduce the per-seat price",
          });
        previousQuantity = tier.minimumQuantity;
        previousPrice = tier.unitPriceCents;
      }
      const identifiers = new Set<string>();
      for (const [sectionIndex, section] of draft.sections.entries()) {
        if (identifiers.has(section.id))
          context.addIssue({
            code: "custom",
            path: ["sections", sectionIndex, "id"],
            message: "Section identifiers must be unique",
          });
        identifiers.add(section.id);
        for (const [itemIndex, item] of section.items.entries()) {
          if (identifiers.has(item.id))
            context.addIssue({
              code: "custom",
              path: ["sections", sectionIndex, "items", itemIndex, "id"],
              message: "Item identifiers must be unique",
            });
          identifiers.add(item.id);
        }
      }
    }),
  );

export type AdminCourseCreateInput = z.infer<typeof adminCourseCreateSchema>;
export type AdminCourseDraft = z.infer<typeof adminCourseDraftSchema>;
export type AdminCourseEnrollmentCreateInput = z.infer<
  typeof adminCourseEnrollmentCreateSchema
>;
export type AdminCourseEnrollmentRemoveInput = z.infer<
  typeof adminCourseEnrollmentRemoveSchema
>;
export type AdminCourseRosterSearch = z.infer<
  typeof adminCourseRosterSearchSchema
>;
export type AdminCourseItem = z.infer<typeof adminCourseItemSchema>;

export interface AdminCourseSummary {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published" | "archived";
  latestVersion: number;
  draftVersion: number | null;
  publishedVersion: number | null;
  enrollmentCount: number;
  canDelete: boolean;
}

interface AdminCourseModuleOption {
  id: string;
  packageId: string;
  title: string;
  version: number;
}

interface AdminCourseSurveyOption {
  id: string;
  surveyId: string;
  title: string;
  version: number;
}

export interface AdminCourseDetail {
  course: {
    id: string;
    slug: string;
    title: string;
    status: "draft" | "published" | "archived";
    enrollmentCount: number;
    canDelete: boolean;
  };
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
  draft: AdminCourseDraft;
  emailTemplates: Array<AdminCommunicationTemplateOption>;
  emailVariableGroups: Array<EmailTemplateVariableGroup>;
  library: {
    modules: Array<AdminCourseModuleOption>;
    resources: Array<AdminCourseResourceOption>;
    surveys: Array<AdminCourseSurveyOption>;
  };
}

export interface AdminCourseRosterDirectory {
  enrollments: Array<{
    enrollmentId: string;
    learnerId: string;
    learnerName: string;
    learnerEmail: string;
    courseVersion: number;
    state: "active" | "completed" | "expired" | "removed";
    enrolledAt: string;
    completedAt: string | null;
    expiresAt: string | null;
    removedAt: string | null;
  }>;
  pagination: { page: number; pages: number; total: number; pageSize: number };
  query: string;
}

export type AdminCourseResult<T> =
  | { status: "ready"; data: T }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export type AdminCourseDetailResult =
  AdminCourseResult<AdminCourseDetail> | { status: "not-found" };

export type AdminCourseRosterResult =
  AdminCourseResult<AdminCourseRosterDirectory> | { status: "not-found" };

export type AdminCourseMutationResult =
  | AdminCourseResult<{
      outcome: "created" | "saved" | "published" | "archived" | "deleted";
      courseId: string;
      versionId?: string;
    }>
  | { status: "not-found" }
  | { status: "conflict"; reason: string };

export type AdminCourseEnrollmentMutationResult =
  | AdminCourseResult<{
      outcome: "enrolled" | "restored" | "removed" | "unchanged";
      enrollmentId: string;
    }>
  | {
      status: "not-found";
      entity: "course-version" | "learner" | "enrollment";
    }
  | { status: "conflict"; reason: "already-enrolled" };
