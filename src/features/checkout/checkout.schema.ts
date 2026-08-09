import { z } from "zod";
import { courseSlugSchema } from "#/features/catalog/catalog.schema";

export const checkoutCourseInputSchema = courseSlugSchema;

const checkoutSessionIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(255)
  .regex(/^cs_[A-Za-z0-9_]+$/);

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
