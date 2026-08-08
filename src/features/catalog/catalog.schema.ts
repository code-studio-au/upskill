import { z } from "zod";

const courseTopicSchema = z.enum(["leadership", "safety", "technology"]);

export const catalogSearchSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  topic: z.union([z.literal("all"), courseTopicSchema]).catch("all"),
  page: z.coerce.number().int().min(1).max(100).catch(1),
});

export const courseSlugSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100),
});

export type CatalogSearch = z.infer<typeof catalogSearchSchema>;
type CourseTopic = z.infer<typeof courseTopicSchema>;

export const courseContentSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(320),
    description: z.string().trim().min(1).max(10_000),
    topic: courseTopicSchema,
    durationMinutes: z.number().int().positive().max(100_000),
    priceCents: z.number().int().nonnegative().max(100_000_000),
    salePriceCents: z.number().int().nonnegative().max(100_000_000).nullable(),
    currency: z.literal("AUD"),
    featured: z.boolean(),
    listInStore: z.boolean(),
    hasCompletionCertificate: z.boolean(),
    prerequisites: z.array(z.string().trim().min(1).max(240)).max(20),
    accreditations: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(160),
          cpdPoints: z.number().nonnegative().max(10_000).nullable(),
        }),
      )
      .max(20),
    modules: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(160),
          phase: z.enum([
            "pre-learning",
            "content",
            "post-learning",
            "followup",
          ]),
          durationMinutes: z.number().int().positive().max(10_000),
        }),
      )
      .max(200),
  })
  .superRefine((content, context) => {
    if (
      content.salePriceCents !== null &&
      content.salePriceCents >= content.priceCents
    )
      context.addIssue({
        code: "custom",
        path: ["salePriceCents"],
        message: "Sale price must be lower than the standard price",
      });
  });

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
  publishedVersion: number;
}
