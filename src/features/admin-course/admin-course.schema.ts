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
const moneySchema = z
  .number()
  .check(z.int(), z.nonnegative(), z.maximum(100_000_000));
const durationSchema = z
  .number()
  .check(z.int(), z.positive(), z.maximum(100_000));

export const PDF_RESOURCE_MAX_BYTES = 25 * 1024 * 1024;

export const adminCourseParamsSchema = z.object({
  courseId: identifierSchema,
});

export const adminCourseVersionParamsSchema = z.object({
  courseId: identifierSchema,
  versionId: identifierSchema,
});

export const adminCourseCreateSchema = z.object({
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

const accreditationSchema = z.object({
  name: boundedText(160),
  cpdPoints: z.nullable(z.number().check(z.nonnegative(), z.maximum(10_000))),
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
    topic: z.enum(["leadership", "safety", "technology"]),
    durationMinutes: durationSchema,
    priceCents: moneySchema,
    salePriceCents: z.nullable(moneySchema),
    featured: z.boolean(),
    listInStore: z.boolean(),
    hasCompletionCertificate: z.boolean(),
    prerequisites: z.array(boundedText(240)).check(z.maxLength(20)),
    accreditations: z.array(accreditationSchema).check(z.maxLength(20)),
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

export const adminResourceUploadQuerySchema = z.object({
  title: boundedText(200),
  description: optionalText(2_000),
  displayName: boundedText(255),
  resourceId: z.optional(identifierSchema),
});

export const adminResourceUploadFormSchema = z.object({
  title: boundedText(200),
  description: optionalText(2_000),
  document: z.instanceof(File).check(
    z.refine(
      (file) =>
        file.type === "application/pdf" ||
        file.name.toLocaleLowerCase("en-AU").endsWith(".pdf"),
      { message: "Choose a PDF document." },
    ),
    z.refine((file) => file.size > 0, { message: "Choose a PDF document." }),
    z.refine((file) => file.size <= PDF_RESOURCE_MAX_BYTES, {
      message: "The PDF must be 25 MB or smaller.",
    }),
  ),
});

export type AdminCourseCreateInput = z.infer<typeof adminCourseCreateSchema>;
export type AdminCourseDraft = z.infer<typeof adminCourseDraftSchema>;
export type AdminCourseItem = z.infer<typeof adminCourseItemSchema>;
export type AdminResourceUploadQuery = z.infer<
  typeof adminResourceUploadQuerySchema
>;

export interface AdminCourseSummary {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published" | "archived";
  latestVersion: number;
  draftVersion: number | null;
  enrollmentCount: number;
  commerceReferenceCount: number;
  canDelete: boolean;
}

interface AdminCourseModuleOption {
  id: string;
  packageId: string;
  title: string;
  version: number;
}

export interface AdminCourseResourceOption {
  id: string;
  resourceId: string;
  title: string;
  displayName: string;
  description: string;
  version: number;
  sourceBytes: number;
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
    commerceReferenceCount: number;
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
  library: {
    modules: Array<AdminCourseModuleOption>;
    resources: Array<AdminCourseResourceOption>;
    surveys: Array<AdminCourseSurveyOption>;
  };
}

export type AdminCourseResult<T> =
  | { status: "ready"; data: T }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export type AdminCourseDetailResult =
  AdminCourseResult<AdminCourseDetail> | { status: "not-found" };

export type AdminCourseMutationResult =
  | AdminCourseResult<{
      outcome: "created" | "saved" | "published" | "archived" | "deleted";
      courseId: string;
      versionId?: string;
    }>
  | { status: "not-found" }
  | { status: "conflict"; reason: string };
