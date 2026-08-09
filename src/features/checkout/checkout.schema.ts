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

export type CourseCheckoutResult =
  | { status: "redirect"; url: string }
  | { status: "already-enrolled" }
  | { status: "unavailable" }
  | { status: "unauthenticated" };

export interface CheckoutStatus {
  status: "pending" | "paid" | "failed" | "refunded";
  courseTitle: string;
  courseSlug: string;
}
