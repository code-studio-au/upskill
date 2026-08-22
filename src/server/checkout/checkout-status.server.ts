import "@tanstack/react-start/server-only";

import type { CheckoutStatus } from "#/features/checkout/checkout.schema";
import { courseContentSchema } from "#/features/catalog/catalog.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";

export async function findCheckoutStatus(
  sessionId: string,
  user: AuthenticatedUser,
): Promise<CheckoutStatus | null> {
  const row = await getDatabase()
    .selectFrom("order")
    .innerJoin("order_item", "order_item.orderId", "order.id")
    .leftJoin(
      "course_version",
      "course_version.id",
      "order_item.courseVersionId",
    )
    .leftJoin("course", "course.id", "course_version.courseId")
    .leftJoin(
      "event_occurrence",
      "event_occurrence.id",
      "order_item.eventOccurrenceId",
    )
    .select([
      "order.status",
      "order.kind",
      "course.slug",
      "course_version.content",
      "event_occurrence.title as eventTitle",
      "event_occurrence.slug as eventSlug",
    ])
    .select((expression) =>
      expression
        .exists(
          expression
            .selectFrom("outbox_event")
            .select("outbox_event.id")
            .whereRef("outbox_event.aggregateId", "=", "order.id")
            .where("outbox_event.topic", "=", "order.review_required"),
        )
        .as("reviewRequired"),
    )
    .where("order.stripeCheckoutSessionId", "=", sessionId)
    .where("order.purchaserUserId", "=", user.id)
    .executeTakeFirst();
  if (!row) return null;
  if (row.eventTitle && row.eventSlug) {
    if (!row.eventTitle || !row.eventSlug) return null;
    return {
      status: row.status,
      kind:
        row.kind === "individual_purchase" ? "event_registration" : row.kind,
      offeringType: "event",
      offeringTitle: row.eventTitle,
      offeringSlug: row.eventSlug,
      reviewRequired: Boolean(row.reviewRequired),
    };
  }
  if (!row.content || !row.slug) return null;
  if (row.kind === "event_registration") return null;
  const content = courseContentSchema.parse(row.content);
  return {
    status: row.status,
    kind: row.kind,
    offeringType: "course",
    offeringTitle: content.title,
    offeringSlug: row.slug,
    reviewRequired: Boolean(row.reviewRequired),
  };
}
