import { z } from "#/validation/zod";

const courseTopicSchema = z.enum(["leadership", "safety", "technology"]);
const boundedText = (maximum: number) =>
  z.string().check(z.trim(), z.minLength(1), z.maxLength(maximum));
const moneySchema = z
  .number()
  .check(z.int(), z.nonnegative(), z.maximum(100_000_000));

const courseSectionSummarySchema = z.object({
  title: boundedText(160),
  description: z.string().check(z.trim(), z.maxLength(2_000)),
  items: z
    .array(
      z.object({
        title: boundedText(200),
        kind: z.enum(["scorm", "survey", "resource"]),
        required: z.boolean(),
        durationMinutes: z.nullable(
          z.number().check(z.int(), z.positive(), z.maximum(10_000)),
        ),
      }),
    )
    .check(z.maxLength(200)),
});

export const catalogSearchSchema = z.object({
  q: z.catch(z.string().check(z.trim(), z.maxLength(100)), ""),
  topic: z.catch(z.union([z.literal("all"), courseTopicSchema]), "all"),
  page: z.catch(
    z.coerce.number().check(z.int(), z.minimum(1), z.maximum(100)),
    1,
  ),
});

export const courseSlugSchema = z.object({
  slug: z
    .string()
    .check(z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), z.maxLength(100)),
});

export type CatalogSearch = z.infer<typeof catalogSearchSchema>;
type CourseTopic = z.infer<typeof courseTopicSchema>;

export const courseContentSchema = z
  .object({
    title: boundedText(160),
    summary: boundedText(320),
    description: boundedText(10_000),
    topic: courseTopicSchema,
    durationMinutes: z
      .number()
      .check(z.int(), z.positive(), z.maximum(100_000)),
    priceCents: moneySchema,
    salePriceCents: z.nullable(moneySchema),
    currency: z.literal("AUD"),
    featured: z.boolean(),
    listInStore: z.boolean(),
    hasCompletionCertificate: z.boolean(),
    prerequisites: z.array(boundedText(240)).check(z.maxLength(20)),
    accreditations: z
      .array(
        z.object({
          name: boundedText(160),
          cpdPoints: z.nullable(
            z.number().check(z.nonnegative(), z.maximum(10_000)),
          ),
        }),
      )
      .check(z.maxLength(20)),
    modules: z
      .array(
        z.object({
          title: boundedText(160),
          phase: z.enum([
            "pre-learning",
            "content",
            "post-learning",
            "followup",
          ]),
          durationMinutes: z
            .number()
            .check(z.int(), z.positive(), z.maximum(10_000)),
        }),
      )
      .check(z.maxLength(200)),
    sections: z.optional(
      z.array(courseSectionSummarySchema).check(z.maxLength(100)),
    ),
  })
  .check(
    z.superRefine((content, context) => {
      if (
        content.salePriceCents !== null &&
        content.salePriceCents >= content.priceCents
      )
        context.addIssue({
          code: "custom",
          path: ["salePriceCents"],
          message: "Sale price must be lower than the standard price",
        });
    }),
  );

export type CourseContent = z.infer<typeof courseContentSchema>;

export interface CourseSummary {
  slug: string;
  title: string;
  summary: string;
  topic: CourseTopic;
  durationMinutes: number;
  priceCents: number;
  salePriceCents: number | null;
  featured: boolean;
}

export interface CourseDetail extends CourseSummary {
  description: string;
  currency: "AUD";
  hasCompletionCertificate: boolean;
  prerequisites: Array<string>;
  accreditations: CourseContent["accreditations"];
  modules: CourseContent["modules"];
  sections: NonNullable<CourseContent["sections"]>;
  publishedVersion: number;
}
