import { z } from "#/validation/zod";
import { certificateAccreditationsSchema } from "./accreditation";
import { offeringTopicSchema } from "#/features/shared/offering-topic";
import { offeringImageSchema } from "#/features/shared/offering-image";

const boundedText = (maximum: number) =>
  z.string().check(z.trim(), z.minLength(1), z.maxLength(maximum));
const moneySchema = z
  .number()
  .check(z.int(), z.nonnegative(), z.maximum(100_000_000));
const bulkPriceTierSchema = z.object({
  minimumQuantity: z.number().check(z.int(), z.minimum(2), z.maximum(100_000)),
  unitPriceCents: moneySchema.check(z.positive()),
});
export const bulkPricingSchema = z
  .object({
    enabled: z.boolean(),
    tiers: z.array(bulkPriceTierSchema).check(z.maxLength(20)),
  })
  .check(
    z.superRefine((pricing, context) => {
      if (pricing.enabled && pricing.tiers.length === 0)
        context.addIssue({
          code: "custom",
          path: ["tiers"],
          message: "Add at least one bulk-pricing tier",
        });
      let previousQuantity = 1;
      let previousPrice = Number.POSITIVE_INFINITY;
      for (const [index, tier] of pricing.tiers.entries()) {
        if (tier.minimumQuantity <= previousQuantity)
          context.addIssue({
            code: "custom",
            path: ["tiers", index, "minimumQuantity"],
            message: "Bulk-pricing quantities must increase",
          });
        if (tier.unitPriceCents >= previousPrice)
          context.addIssue({
            code: "custom",
            path: ["tiers", index, "unitPriceCents"],
            message: "Each bulk-pricing tier must reduce the per-seat price",
          });
        previousQuantity = tier.minimumQuantity;
        previousPrice = tier.unitPriceCents;
      }
    }),
  );

export type BulkPricing = z.infer<typeof bulkPricingSchema>;

export function resolveBulkUnitPrice(
  pricing: BulkPricing,
  quantity: number,
): number | null {
  if (!pricing.enabled) return null;
  let unitPriceCents: number | null = null;
  for (const tier of pricing.tiers) {
    if (quantity < tier.minimumQuantity) break;
    unitPriceCents = tier.unitPriceCents;
  }
  return unitPriceCents;
}

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
  offering: z.optional(z.catch(z.enum(["courses", "events"]), "courses")),
  q: z.catch(z.string().check(z.trim(), z.maxLength(100)), ""),
  topic: z.catch(
    z.union([z.literal("all"), z.string().check(z.trim(), z.maxLength(80))]),
    "all",
  ),
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
type CourseTopic = z.infer<typeof offeringTopicSchema>;

export const courseContentSchema = z
  .object({
    title: boundedText(160),
    summary: boundedText(320),
    description: boundedText(10_000),
    topic: offeringTopicSchema,
    durationMinutes: z
      .number()
      .check(z.int(), z.positive(), z.maximum(100_000)),
    priceCents: moneySchema,
    salePriceCents: z.nullable(moneySchema),
    bulkPricing: z._default(bulkPricingSchema, { enabled: false, tiers: [] }),
    currency: z.literal("AUD"),
    featured: z.boolean(),
    listInStore: z.boolean(),
    coverImage: z._default(offeringImageSchema, null),
    hasCompletionCertificate: z.boolean(),
    prerequisites: z.array(boundedText(240)).check(z.maxLength(20)),
    accreditations: certificateAccreditationsSchema,
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
      const individualPrice = content.salePriceCents ?? content.priceCents;
      for (const [index, tier] of content.bulkPricing.tiers.entries())
        if (tier.unitPriceCents >= individualPrice)
          context.addIssue({
            code: "custom",
            path: ["bulkPricing", "tiers", index, "unitPriceCents"],
            message: "Bulk seat prices must be lower than the individual price",
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
  coverImage: z.infer<typeof offeringImageSchema>;
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
  bulkPricing: BulkPricing;
}

export interface EventSummary {
  slug: string;
  title: string;
  summary: string;
  topic: CourseTopic;
  coverImage: z.infer<typeof offeringImageSchema>;
  deliveryMode: "in_person" | "virtual";
  registrationMode:
    | "open_entry"
    | "paid_entry"
    | "required_unrestricted"
    | "required_restricted";
  startsAt: string;
  endsAt: string;
  timezone: string;
  priceCents: number | null;
  salePriceCents: number | null;
  currency: "AUD";
  featured: boolean;
  remainingPlaces: number;
}

export interface EventDetail extends EventSummary {
  description: string;
  venueName: string | null;
  venueAddress: string | null;
  hasCompletionCertificate: boolean;
  accreditations: CourseContent["accreditations"];
  bulkPricing: BulkPricing;
  publicAccessReference: string | null;
  regions: Array<{ code: string; name: string; groupName: string | null }>;
  sessions: Array<{
    title: string;
    startsAt: string;
    endsAt: string;
    venueName: string | null;
  }>;
}
