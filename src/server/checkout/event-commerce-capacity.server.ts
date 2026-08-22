import "@tanstack/react-start/server-only";

import { sql, type Kysely } from "kysely";
import type { Database } from "#/server/db/types";
import { EVENT_RESERVATION_MINUTES } from "./event-reservation";

export async function findReservedEventPlaces(
  database: Kysely<Database>,
  eventOccurrenceId: string,
  now: Date,
): Promise<number> {
  return (
    (
      await findReservedEventPlacesByOccurrence(
        database,
        [eventOccurrenceId],
        now,
      )
    ).get(eventOccurrenceId) ?? 0
  );
}

export async function findReservedEventPlacesByOccurrence(
  database: Kysely<Database>,
  eventOccurrenceIds: Array<string>,
  now: Date,
): Promise<Map<string, number>> {
  if (eventOccurrenceIds.length === 0) return new Map();
  const pendingBoundary = new Date(
    now.getTime() - EVENT_RESERVATION_MINUTES * 60_000,
  );
  const [pending, grants] = await Promise.all([
    database
      .selectFrom("order_item as item")
      .innerJoin("order", "order.id", "item.orderId")
      .select([
        "item.eventOccurrenceId",
        sql<number>`sum(item.quantity)::integer`.as("count"),
      ])
      .where("item.eventOccurrenceId", "in", eventOccurrenceIds)
      .where("order.status", "=", "pending")
      .where("order.createdAt", ">", pendingBoundary)
      .groupBy("item.eventOccurrenceId")
      .execute(),
    database
      .selectFrom("access_grant")
      .select([
        "eventOccurrenceId",
        sql<number>`sum(quantity - redeemed)::integer`.as("count"),
      ])
      .where("eventOccurrenceId", "in", eventOccurrenceIds)
      .where("revokedAt", "is", null)
      .where((expression) =>
        expression.or([
          expression("expiresAt", "is", null),
          expression("expiresAt", ">", now),
        ]),
      )
      .groupBy("eventOccurrenceId")
      .execute(),
  ]);
  const reservations = new Map(
    eventOccurrenceIds.map((eventOccurrenceId) => [eventOccurrenceId, 0]),
  );
  for (const row of [...pending, ...grants]) {
    if (!row.eventOccurrenceId) continue;
    reservations.set(
      row.eventOccurrenceId,
      (reservations.get(row.eventOccurrenceId) ?? 0) + row.count,
    );
  }
  return reservations;
}
