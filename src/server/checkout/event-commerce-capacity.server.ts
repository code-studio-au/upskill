import "@tanstack/react-start/server-only";

import { sql, type Kysely } from "kysely";
import type { Database } from "#/server/db/types";

const PENDING_RESERVATION_MINUTES = 31;

export async function findReservedEventPlaces(
  database: Kysely<Database>,
  eventOccurrenceId: string,
  now: Date,
): Promise<number> {
  const pendingBoundary = new Date(
    now.getTime() - PENDING_RESERVATION_MINUTES * 60_000,
  );
  const [pending, grants] = await Promise.all([
    database
      .selectFrom("order_item as item")
      .innerJoin("order", "order.id", "item.orderId")
      .select(sql<number>`coalesce(sum(item.quantity), 0)::integer`.as("count"))
      .where("item.eventOccurrenceId", "=", eventOccurrenceId)
      .where("order.status", "=", "pending")
      .where("order.createdAt", ">", pendingBoundary)
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("access_grant")
      .select(
        sql<number>`coalesce(sum(quantity - redeemed), 0)::integer`.as("count"),
      )
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .where("revokedAt", "is", null)
      .where((expression) =>
        expression.or([
          expression("expiresAt", "is", null),
          expression("expiresAt", ">", now),
        ]),
      )
      .executeTakeFirstOrThrow(),
  ]);
  return pending.count + grants.count;
}
