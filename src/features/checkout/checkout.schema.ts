import { z } from "#/validation/zod";
import { courseSlugSchema } from "#/features/catalog/catalog.schema";
import { accountInvitationSchema } from "#/features/auth/account-invitation.schema";

export const checkoutCourseInputSchema = courseSlugSchema;
export const checkoutEventInputSchema = courseSlugSchema;

export const preparePurchaseAccountInputSchema = z.object({
  ...accountInvitationSchema.shape,
  offeringType: z.enum(["course", "event"]),
  slug: courseSlugSchema.shape.slug,
});

export type PreparePurchaseAccountInput = z.infer<
  typeof preparePurchaseAccountInputSchema
>;

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

export type EventCheckoutResult =
  | { status: "redirect"; url: string }
  | { status: "already-registered" }
  | { status: "unavailable" }
  | { status: "unauthenticated" };

export type BulkCheckoutResult =
  | { status: "redirect"; url: string }
  | {
      status: "unavailable";
      reason:
        | "course"
        | "event"
        | "quantity"
        | "grant"
        | "payment"
        | "unauthenticated";
    };

type PaymentState =
  "pending" | "paid" | "failed" | "partially_refunded" | "refunded";

export type CheckoutStatus =
  | {
      status: PaymentState;
      kind: "individual_purchase" | "bulk_purchase" | "capacity_extension";
      offeringType: "course";
      offeringTitle: string;
      offeringSlug: string;
      reviewRequired: boolean;
    }
  | {
      status: PaymentState;
      kind: "event_registration" | "bulk_purchase" | "capacity_extension";
      offeringType: "event";
      offeringTitle: string;
      offeringSlug: string;
      eventOccurrenceId: string;
      registrationRequired: boolean;
      reviewRequired: boolean;
    };

export function shouldRedirectToEventRegistrationQuestionnaire(
  checkout: CheckoutStatus,
): boolean {
  const paymentCompleted =
    checkout.status === "paid" ||
    checkout.status === "partially_refunded" ||
    checkout.status === "refunded";
  return (
    checkout.offeringType === "event" &&
    checkout.kind === "event_registration" &&
    paymentCompleted &&
    !checkout.reviewRequired &&
    checkout.registrationRequired
  );
}
