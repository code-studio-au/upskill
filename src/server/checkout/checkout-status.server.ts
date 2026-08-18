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
    .innerJoin(
      "course_version",
      "course_version.id",
      "order_item.courseVersionId",
    )
    .innerJoin("course", "course.id", "course_version.courseId")
    .select([
      "order.status",
      "order.kind",
      "course.slug",
      "course_version.content",
    ])
    .where("order.stripeCheckoutSessionId", "=", sessionId)
    .where("order.purchaserUserId", "=", user.id)
    .executeTakeFirst();
  if (!row) return null;
  const content = courseContentSchema.parse(row.content);
  return {
    status: row.status,
    kind: row.kind,
    courseTitle: content.title,
    courseSlug: row.slug,
  };
}
