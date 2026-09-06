import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { Database } from "#/server/db/types";
import { eventVirtualPresenterIdentity } from "./event-virtual-participant-identity.server";
import { hasVirtualRoomStaffAccess } from "./event-virtual-staff-access.server";

export async function enqueueEventVirtualParticipantRemoval(
  transaction: Transaction<Database>,
  input: {
    roomId: string;
    lobbyEntryId: string;
    participantIdentity: string;
    requestedByUserId: string | null;
    now: Date;
  },
): Promise<void> {
  await transaction
    .insertInto("event_virtual_room_operation")
    .values({
      id: `event_virtual_room_operation_${randomUUID()}`,
      roomId: input.roomId,
      kind: "remove_participant",
      targetKey: input.lobbyEntryId,
      lobbyEntryId: input.lobbyEntryId,
      presenterUserId: null,
      participantIdentity: input.participantIdentity,
      deduplicationKey: `event_virtual_room:${input.roomId}:remove_participant:${input.lobbyEntryId}`,
      status: "pending",
      attempts: 0,
      availableAt: input.now,
      leasedUntil: null,
      lastAttemptAt: null,
      completedAt: null,
      lastErrorCode: null,
      requestedByUserId: input.requestedByUserId,
      createdAt: input.now,
    })
    .onConflict((conflict) =>
      conflict.columns(["roomId", "kind", "targetKey"]).doUpdateSet({
        status: "pending",
        availableAt: input.now,
        leasedUntil: null,
        completedAt: null,
        lastErrorCode: null,
        requestedByUserId: input.requestedByUserId,
      }),
    )
    .execute();
}

async function enqueueEventVirtualPresenterRemoval(
  transaction: Transaction<Database>,
  input: {
    roomId: string;
    presenterUserId: string;
    requestedByUserId: string | null;
    now: Date;
  },
): Promise<void> {
  const targetKey = `presenter:${input.presenterUserId}`;
  await transaction
    .insertInto("event_virtual_room_operation")
    .values({
      id: `event_virtual_room_operation_${randomUUID()}`,
      roomId: input.roomId,
      kind: "remove_participant",
      targetKey,
      lobbyEntryId: null,
      presenterUserId: input.presenterUserId,
      participantIdentity: eventVirtualPresenterIdentity(
        input.roomId,
        input.presenterUserId,
      ),
      deduplicationKey: `event_virtual_room:${input.roomId}:remove_participant:${targetKey}`,
      status: "pending",
      attempts: 0,
      availableAt: input.now,
      leasedUntil: null,
      lastAttemptAt: null,
      completedAt: null,
      lastErrorCode: null,
      requestedByUserId: input.requestedByUserId,
      createdAt: input.now,
    })
    .onConflict((conflict) =>
      conflict.columns(["roomId", "kind", "targetKey"]).doUpdateSet({
        status: "pending",
        availableAt: input.now,
        leasedUntil: null,
        completedAt: null,
        lastErrorCode: null,
        requestedByUserId: input.requestedByUserId,
      }),
    )
    .execute();
}

export async function enqueueRevokedEventVirtualPresenterAccess(
  transaction: Transaction<Database>,
  input: {
    presenterUserId: string;
    requestedByUserId: string | null;
    now: Date;
  },
): Promise<void> {
  const reservations = await transaction
    .selectFrom("event_virtual_presenter_credential_reservation as reservation")
    .innerJoin("event_virtual_room as room", "room.id", "reservation.roomId")
    .innerJoin("event_session as session", "session.id", "room.eventSessionId")
    .select([
      "room.id as roomId",
      "room.eventSessionId",
      "session.eventOccurrenceId",
    ])
    .where("reservation.userId", "=", input.presenterUserId)
    .execute();
  for (const reservation of reservations) {
    if (
      await hasVirtualRoomStaffAccess(
        transaction,
        reservation.eventOccurrenceId,
        reservation.eventSessionId,
        input.presenterUserId,
      )
    )
      continue;
    await enqueueEventVirtualPresenterRemoval(transaction, {
      roomId: reservation.roomId,
      presenterUserId: input.presenterUserId,
      requestedByUserId: input.requestedByUserId,
      now: input.now,
    });
  }
}
