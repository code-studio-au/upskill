import { z } from "#/validation/zod";
import { courseSlugSchema } from "#/features/catalog/catalog.schema";

export const checkoutCourseInputSchema = courseSlugSchema;

const checkoutSessionIdSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(8),
    z.maxLength(255),
    z.regex(/^cs_[A-Za-z0-9_]+$/),
  );

export const checkoutSessionSearchSchema = z.object({
  session_id: checkoutSessionIdSchema,
});

export const checkoutStatusInputSchema = z.object({
  sessionId: checkoutSessionIdSchema,
});

const boundedText = (maximum: number) =>
  z.string().check(z.trim(), z.minLength(2), z.maxLength(maximum));
const quantitySchema = z
  .number()
  .check(z.int(), z.minimum(1), z.maximum(100_000));

export const bulkOrderCheckoutInputSchema = z.object({
  slug: courseSlugSchema.shape.slug,
  organizationName: boundedText(120),
  quantity: quantitySchema.check(z.minimum(2)),
  fulfillmentMode: z.enum(["shared_code", "single_use_codes"]),
});

export const capacityExtensionCheckoutInputSchema = z.object({
  accessGrantId: z.string().check(z.trim(), z.minLength(1), z.maxLength(255)),
  quantity: quantitySchema,
});

export type BulkOrderCheckoutInput = z.infer<
  typeof bulkOrderCheckoutInputSchema
>;
export type CapacityExtensionCheckoutInput = z.infer<
  typeof capacityExtensionCheckoutInputSchema
>;

export type CourseCheckoutResult =
  | { status: "redirect"; url: string }
  | { status: "already-enrolled" }
  | { status: "unavailable" }
  | { status: "unauthenticated" };

export type BulkCheckoutResult =
  | { status: "redirect"; url: string }
  | {
      status: "unavailable";
      reason: "course" | "quantity" | "grant" | "payment" | "unauthenticated";
    };

export interface CheckoutStatus {
  status: "pending" | "paid" | "failed" | "partially_refunded" | "refunded";
  kind: "individual_purchase" | "bulk_purchase" | "capacity_extension";
  courseTitle: string;
  courseSlug: string;
}
