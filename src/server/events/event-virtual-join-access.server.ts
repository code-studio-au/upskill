import "@tanstack/react-start/server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { Database } from "#/server/db/types";

function publicReference(): string {
  return randomBytes(32).toString("base64url");
}

async function revokeJoinAccess(
  transaction: Transaction<Database>,
  access: {
    id: string;
    eventOccurrenceId: string;
    eventSessionId: string;
    roomGeneration: number;
  },
  actorUserId: string,
  now: Date,
): Promise<void> {
  await transaction
    .updateTable("event_virtual_join_access")
    .set({ revokedAt: now, revokedByUserId: actorUserId })
    .where("id", "=", access.id)
    .where("revokedAt", "is", null)
    .execute();
  await transaction
    .updateTable("event_virtual_lobby_entry")
    .set({
      state: "revoked",
      revokedAt: now,
      revokedByUserId: actorUserId,
      updatedAt: now,
    })
    .where("eventVirtualJoinAccessId", "=", access.id)
    .where("state", "!=", "revoked")
    .execute();
  await transaction
    .updateTable("event_virtual_join_session")
    .set({ revokedAt: now })
    .where("eventVirtualJoinAccessId", "=", access.id)
    .where("revokedAt", "is", null)
    .execute();
  await transaction
    .updateTable("event_virtual_recovery_challenge")
    .set({ consumedAt: now })
    .where("eventVirtualJoinAccessId", "=", access.id)
    .where("consumedAt", "is", null)
    .execute();
  await recordDurableAuditEvent(transaction, {
    actorUserId,
    action: "event_virtual_join_access.revoked",
    subjectType: "event_virtual_join_access",
    subjectId: access.id,
    aggregateId: access.eventOccurrenceId,
    metadata: {
      eventSessionId: access.eventSessionId,
      roomGeneration: access.roomGeneration,
    },
    createdAt: now,
  });
}

export async function ensureEventVirtualJoinAccess(
  transaction: Transaction<Database>,
  input: {
    eventOccurrenceId: string;
    eventSessionId: string;
    roomGeneration: number;
    actorUserId: string;
    now: Date;
  },
) {
  await sql`select pg_advisory_xact_lock(
    hashtextextended(${`${input.eventSessionId}:virtual-join-access`}, 0)
  )`.execute(transaction);
  const active = await transaction
    .selectFrom("event_virtual_join_access")
    .select([
      "id",
      "eventOccurrenceId",
      "eventSessionId",
      "roomGeneration",
      "publicReference",
    ])
    .where("eventSessionId", "=", input.eventSessionId)
    .where("revokedAt", "is", null)
    .forUpdate()
    .executeTakeFirst();
  if (
    active &&
    active.eventOccurrenceId === input.eventOccurrenceId &&
    active.roomGeneration === input.roomGeneration
  )
    return active;
  if (active)
    await revokeJoinAccess(transaction, active, input.actorUserId, input.now);

  const access = await transaction
    .insertInto("event_virtual_join_access")
    .values({
      id: `event_virtual_join_access_${randomUUID()}`,
      eventOccurrenceId: input.eventOccurrenceId,
      eventSessionId: input.eventSessionId,
      roomGeneration: input.roomGeneration,
      publicReference: publicReference(),
      createdAt: input.now,
      revokedAt: null,
      revokedByUserId: null,
    })
    .returning([
      "id",
      "eventOccurrenceId",
      "eventSessionId",
      "roomGeneration",
      "publicReference",
    ])
    .executeTakeFirstOrThrow();
  await recordDurableAuditEvent(transaction, {
    actorUserId: input.actorUserId,
    action: "event_virtual_join_access.created",
    subjectType: "event_virtual_join_access",
    subjectId: access.id,
    aggregateId: input.eventOccurrenceId,
    metadata: {
      eventSessionId: input.eventSessionId,
      roomGeneration: input.roomGeneration,
    },
    createdAt: input.now,
  });
  return access;
}

export async function ensureEventVirtualJoinAccessRecords(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
  actorUserId: string,
  now: Date,
): Promise<void> {
  const sessions = await transaction
    .selectFrom("event_session")
    .select(["id", "virtualDeliveryProvider"])
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .execute();
  for (const session of sessions) {
    if (session.virtualDeliveryProvider !== "livekit") continue;
    const room = await transaction
      .selectFrom("event_virtual_room")
      .select("generation")
      .where("eventSessionId", "=", session.id)
      .where("replacedAt", "is", null)
      .executeTakeFirst();
    const existing = await transaction
      .selectFrom("event_virtual_join_access")
      .select("roomGeneration")
      .where("eventSessionId", "=", session.id)
      .where("revokedAt", "is", null)
      .executeTakeFirst();
    await ensureEventVirtualJoinAccess(transaction, {
      eventOccurrenceId,
      eventSessionId: session.id,
      roomGeneration: room?.generation ?? existing?.roomGeneration ?? 1,
      actorUserId,
      now,
    });
  }
}
