import "@tanstack/react-start/server-only";

import type { Kysely, Transaction } from "kysely";
import type { Database } from "#/server/db/types";
import {
  eventVirtualAttendeeIdentity,
  eventVirtualPresenterIdentity,
} from "./event-virtual-participant-identity.server";

type DatabaseConnection = Kysely<Database> | Transaction<Database>;

export async function countUnconnectedVirtualCredentialReservations(
  connection: DatabaseConnection,
  input: {
    roomId: string;
    eventSessionId: string;
    roomGeneration: number;
    connectedIdentities: ReadonlySet<string>;
    now: Date;
    excludingLobbyEntryId?: string;
    excludingPresenterUserId?: string;
  },
): Promise<{ attendees: number; presenters: number; total: number }> {
  let attendeeQuery = connection
    .selectFrom("event_virtual_lobby_entry")
    .select(["id", "eventParticipationId"])
    .where("eventSessionId", "=", input.eventSessionId)
    .where("roomGeneration", "=", input.roomGeneration)
    .where("credentialExpiresAt", ">", input.now);
  if (input.excludingLobbyEntryId)
    attendeeQuery = attendeeQuery.where(
      "id",
      "!=",
      input.excludingLobbyEntryId,
    );
  let presenterQuery = connection
    .selectFrom("event_virtual_presenter_credential_reservation")
    .select("userId")
    .where("roomId", "=", input.roomId)
    .where("credentialExpiresAt", ">", input.now);
  if (input.excludingPresenterUserId)
    presenterQuery = presenterQuery.where(
      "userId",
      "!=",
      input.excludingPresenterUserId,
    );
  const attendeeReservations = await attendeeQuery.execute();
  const presenterReservations = await presenterQuery.execute();
  const attendees = attendeeReservations.filter(
    (reservation) =>
      !input.connectedIdentities.has(
        eventVirtualAttendeeIdentity(
          input.roomId,
          reservation.eventParticipationId,
        ),
      ),
  ).length;
  const presenters = presenterReservations.filter(
    (reservation) =>
      !input.connectedIdentities.has(
        eventVirtualPresenterIdentity(input.roomId, reservation.userId),
      ),
  ).length;
  return { attendees, presenters, total: attendees + presenters };
}
