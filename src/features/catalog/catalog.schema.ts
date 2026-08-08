import { z } from "zod";

export const catalogSearchSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  topic: z.enum(["all", "leadership", "safety", "technology"]).catch("all"),
  page: z.coerce.number().int().min(1).max(100).catch(1),
});

export const courseSlugSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100),
});

export type CatalogSearch = z.infer<typeof catalogSearchSchema>;

export interface CourseSummary {
  slug: string;
  title: string;
  summary: string;
  topic: Exclude<CatalogSearch["topic"], "all">;
  durationMinutes: number;
  priceCents: number;
  featured: boolean;
}
