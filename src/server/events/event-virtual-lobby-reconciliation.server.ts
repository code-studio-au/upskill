import "@tanstack/react-start/server-only";

import type { Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { advanceEventVirtualLobbyRevision } from "./event-virtual-join-access.server";
import { eventVirtualAttendeeIdentity } from "./event-virtual-participant-identity.server";
import { enqueueEventVirtualParticipantRemoval } from "./event-virtual-provider-operation.server";

type RevocableLobbyState =
  "waiting" | "admitted" | "token_issued" | "connected" | "left";

interface EligibilityRevocationInput {
  entry: {
    id: string;
    state: RevocableLobbyState;
    credentialExpiresAt: Date | null;
    eventParticipationId: string;
  };
  eventVirtualJoinAccessId: string;
  eventOccurrenceId: string;
  eventSessionId: string;
  roomId: string | null;
  userId: string;
  now: Date;
}

interface EventVirtualLobbyEligibilityRevocationOutcome {
  status: "revoked";
  lobbyEntryId: string;
}

export interface EventVirtualLobbyEligibilityRevocationBatch {
  outcomes: EventVirtualLobbyEligibilityRevocationOutcome[];
  limitReached: boolean;
}

export async function revokeEventVirtualLobbyEntryForEligibility(
  transaction: Transaction<Database>,
  input: EligibilityRevocationInput,
): Promise<void> {
  await transaction
    .updateTable("event_virtual_lobby_entry")
    .set({
      state: "revoked",
      revokedAt: input.now,
      revokedByUserId: null,
      updatedAt: input.now,
    })
    .where("id", "=", input.entry.id)
    .execute();
  const roomId = input.roomId;
  if (
    roomId &&
    (["token_issued", "connected", "left"].includes(input.entry.state) ||
      (input.entry.credentialExpiresAt?.getTime() ?? 0) > input.now.getTime())
  )
    await enqueueEventVirtualParticipantRemoval(transaction, {
      roomId,
      lobbyEntryId: input.entry.id,
      participantIdentity: eventVirtualAttendeeIdentity(
        roomId,
        input.entry.eventParticipationId,
      ),
      requestedByUserId: null,
      now: input.now,
    });
  await advanceEventVirtualLobbyRevision(
    transaction,
    input.eventVirtualJoinAccessId,
  );
  await recordDurableAuditEvent(transaction, {
    actorUserId: null,
    action: "event_virtual_lobby.admission_changed",
    subjectType: "event_virtual_lobby_entry",
    subjectId: input.entry.id,
    aggregateId: input.eventOccurrenceId,
    metadata: {
      action: "revoke",
      eventSessionId: input.eventSessionId,
      source: "eligibility_changed",
    },
    createdAt: input.now,
  });
  await transaction
    .updateTable("event_virtual_join_session")
    .set({ revokedAt: input.now })
    .where("eventVirtualJoinAccessId", "=", input.eventVirtualJoinAccessId)
    .where("userId", "=", input.userId)
    .where("revokedAt", "is", null)
    .execute();
}

async function revokeNextIneligibleLobbyEntry(
  now: Date,
): Promise<EventVirtualLobbyEligibilityRevocationOutcome | null> {
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const candidate = await transaction
        .selectFrom("event_virtual_lobby_entry as lobby")
        .innerJoin(
          "event_virtual_join_access as access",
          "access.id",
          "lobby.eventVirtualJoinAccessId",
        )
        .innerJoin("event_virtual_room as room", (join) =>
          join
            .onRef("room.eventSessionId", "=", "access.eventSessionId")
            .onRef("room.generation", "=", "access.roomGeneration"),
        )
        .innerJoin(
          "event_participation as participation",
          "participation.id",
          "lobby.eventParticipationId",
        )
        .innerJoin(
          "event_registration as registration",
          "registration.id",
          "participation.registrationId",
        )
        .select([
          "lobby.id as lobbyEntryId",
          "lobby.state",
          "lobby.credentialExpiresAt",
          "lobby.eventParticipationId",
          "access.id as eventVirtualJoinAccessId",
          "access.eventOccurrenceId",
          "access.eventSessionId",
          "room.id as roomId",
          "participation.userId",
        ])
        .where("access.revokedAt", "is", null)
        .where("room.replacedAt", "is", null)
        .where("registration.status", "!=", "selected")
        .where("lobby.state", "not in", ["declined", "revoked"])
        .orderBy("lobby.updatedAt")
        .orderBy("lobby.id")
        .forUpdate(["lobby", "access", "room", "participation", "registration"])
        .skipLocked()
        .executeTakeFirst();
      if (!candidate) return null;
      await revokeEventVirtualLobbyEntryForEligibility(transaction, {
        entry: {
          id: candidate.lobbyEntryId,
          state: candidate.state as RevocableLobbyState,
          credentialExpiresAt: candidate.credentialExpiresAt,
          eventParticipationId: candidate.eventParticipationId,
        },
        eventVirtualJoinAccessId: candidate.eventVirtualJoinAccessId,
        eventOccurrenceId: candidate.eventOccurrenceId,
        eventSessionId: candidate.eventSessionId,
        roomId: candidate.roomId,
        userId: candidate.userId,
        now,
      });
      return { status: "revoked", lobbyEntryId: candidate.lobbyEntryId };
    });
}

export async function processAvailableEventVirtualLobbyEligibilityRevocations(
  limit = 10,
  options: { now?: Date } = {},
): Promise<EventVirtualLobbyEligibilityRevocationBatch> {
  const outcomes: EventVirtualLobbyEligibilityRevocationOutcome[] = [];
  for (let index = 0; index < limit; index += 1) {
    const outcome = await revokeNextIneligibleLobbyEntry(
      options.now ?? new Date(),
    );
    if (!outcome) return { outcomes, limitReached: false };
    outcomes.push(outcome);
  }
  return { outcomes, limitReached: true };
}
