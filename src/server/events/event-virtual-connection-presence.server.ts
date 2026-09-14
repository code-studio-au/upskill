import "@tanstack/react-start/server-only";

import type { Transaction } from "kysely";
import type { Database } from "#/server/db/types";
import { advanceEventVirtualLobbyRevision } from "./event-virtual-join-access.server";

export type EventVirtualPresenceLobbyEntry = {
  id: string;
  eventVirtualJoinAccessId: string;
  eventParticipationId: string;
  state:
    | "waiting"
    | "admitted"
    | "token_issued"
    | "connected"
    | "left"
    | "declined"
    | "revoked";
  firstConnectedAt: Date | null;
  lastSeenAt: Date | null;
  leftAt: Date | null;
  updatedAt: Date;
};

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

export async function projectEventVirtualLobbyPresence(
  transaction: Transaction<Database>,
  entry: EventVirtualPresenceLobbyEntry,
  observedAt: Date,
): Promise<void> {
  const intervals = await transaction
    .selectFrom("event_virtual_connection_interval")
    .select(["joinedAt", "leftAt"])
    .where("eventVirtualJoinAccessId", "=", entry.eventVirtualJoinAccessId)
    .where("eventParticipationId", "=", entry.eventParticipationId)
    .orderBy("joinedAt")
    .orderBy("id")
    .execute();
  if (!intervals.length) return;

  const firstConnectedAt = intervals[0]?.joinedAt ?? null;
  const hasOpenConnection = intervals.some((interval) => !interval.leftAt);
  const observedInstants = intervals.flatMap((interval) =>
    interval.leftAt
      ? [interval.joinedAt, interval.leftAt]
      : [interval.joinedAt],
  );
  const lastSeenAt = new Date(
    Math.max(...observedInstants.map((instant) => instant.getTime())),
  );
  const leftAt = hasOpenConnection
    ? null
    : new Date(
        Math.max(
          ...intervals.map((interval) => interval.leftAt?.getTime() ?? 0),
        ),
      );
  const projectedState = ["token_issued", "connected", "left"].includes(
    entry.state,
  )
    ? hasOpenConnection
      ? "connected"
      : "left"
    : entry.state;
  if (
    entry.state === projectedState &&
    sameInstant(entry.firstConnectedAt, firstConnectedAt) &&
    sameInstant(entry.lastSeenAt, lastSeenAt) &&
    sameInstant(entry.leftAt, leftAt)
  )
    return;

  await transaction
    .updateTable("event_virtual_lobby_entry")
    .set({
      state: projectedState,
      firstConnectedAt,
      lastSeenAt,
      leftAt,
      updatedAt: new Date(
        Math.max(observedAt.getTime(), entry.updatedAt.getTime()),
      ),
    })
    .where("id", "=", entry.id)
    .executeTakeFirstOrThrow();
  await advanceEventVirtualLobbyRevision(
    transaction,
    entry.eventVirtualJoinAccessId,
    entry.id,
  );
}
