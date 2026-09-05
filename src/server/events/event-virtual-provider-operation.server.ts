import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { Database } from "#/server/db/types";

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
