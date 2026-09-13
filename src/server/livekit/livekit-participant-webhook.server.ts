import "@tanstack/react-start/server-only";

import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { getServerEnv, type ServerEnv } from "#/server/env.server";
import { advanceEventVirtualLobbyRevision } from "#/server/events/event-virtual-join-access.server";
import {
  eventVirtualAttendeeIdentity,
  isEventVirtualAttendeeIdentity,
} from "#/server/events/event-virtual-participant-identity.server";
import type { VerifiedLiveKitWebhook } from "./livekit-webhook.server";

type ParticipantEventName =
  "participant_joined" | "participant_left" | "participant_connection_aborted";

type MatchedLobbyEntry = {
  id: string;
  eventVirtualJoinAccessId: string;
  eventOccurrenceId: string;
  eventSessionId: string;
  roomGeneration: number;
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

function isParticipantEventName(value: string): value is ParticipantEventName {
  return (
    value === "participant_joined" ||
    value === "participant_left" ||
    value === "participant_connection_aborted"
  );
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

async function projectLobbyPresence(
  transaction: Transaction<Database>,
  entry: MatchedLobbyEntry,
  observedAt: Date,
): Promise<void> {
  if (!["token_issued", "connected", "left"].includes(entry.state)) return;
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
  const state = hasOpenConnection ? "connected" : "left";
  if (
    entry.state === state &&
    sameInstant(entry.firstConnectedAt, firstConnectedAt) &&
    sameInstant(entry.lastSeenAt, lastSeenAt) &&
    sameInstant(entry.leftAt, leftAt)
  )
    return;

  await transaction
    .updateTable("event_virtual_lobby_entry")
    .set({
      state,
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
  );
}

export type LiveKitParticipantWebhookIngestionOutcome =
  | { status: "processed"; receiptId: string; lobbyEntryId: string }
  | { status: "duplicate"; receiptId: string }
  | { status: "unmatched" | "ignored"; receiptId: string }
  | { status: "unsupported" };

export async function ingestVerifiedLiveKitParticipantWebhook(
  event: VerifiedLiveKitWebhook,
  database: Kysely<Database> = getDatabase(),
  environment: ServerEnv = getServerEnv(),
  clock: () => Date = () => new Date(),
): Promise<LiveKitParticipantWebhookIngestionOutcome> {
  const roomSid = event.roomSid;
  const roomName = event.roomName;
  const participantSid = event.participantSid;
  const participantIdentity = event.participantIdentity;
  if (
    !isParticipantEventName(event.event) ||
    !roomSid ||
    !roomName ||
    !participantSid ||
    !participantIdentity
  )
    return { status: "unsupported" };
  if (environment.LIVEKIT_PROJECT_ENVIRONMENT !== event.providerEnvironment)
    throw new TypeError("Webhook provider environment mismatch");

  const providerCreatedAt = new Date(event.createdAtSeconds * 1_000);
  if (Number.isNaN(providerCreatedAt.getTime()))
    throw new RangeError("Provider webhook timestamp is invalid");
  const receivedAt = clock();
  if (Number.isNaN(receivedAt.getTime()))
    throw new RangeError("Webhook receipt timestamp is invalid");
  const eventType = event.event;
  const participantIdentityDigest = digest(participantIdentity);

  return database.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(
      ${`${event.providerEnvironment}:${event.providerEventId}`}, 0
    ))`.execute(transaction);
    const recordingReceipt = await transaction
      .selectFrom("livekit_webhook_receipt")
      .select("id")
      .where("providerEnvironment", "=", event.providerEnvironment)
      .where("providerEventId", "=", event.providerEventId)
      .executeTakeFirst();
    if (recordingReceipt)
      throw new TypeError("Webhook event identity was reused");

    const receiptId = `livekit_participant_webhook_receipt_${randomUUID()}`;
    const inserted = await transaction
      .insertInto("livekit_participant_webhook_receipt")
      .values({
        id: receiptId,
        provider: "livekit",
        providerEnvironment: event.providerEnvironment,
        providerEventId: event.providerEventId,
        eventType,
        payloadDigest: event.payloadDigest,
        providerCreatedAt,
        receivedAt,
        providerRoomSid: roomSid,
        providerRoomName: roomName,
        providerParticipantSid: participantSid,
        participantIdentityDigest,
        processingState: "processing",
        processedAt: null,
        matchedRoomId: null,
        matchedLobbyEntryId: null,
        matchedEventVirtualJoinAccessId: null,
        matchedEventOccurrenceId: null,
        matchedEventSessionId: null,
        matchedRoomGeneration: null,
        matchedEventParticipationId: null,
      })
      .onConflict((conflict) =>
        conflict
          .columns(["providerEnvironment", "providerEventId"])
          .doNothing(),
      )
      .returning("id")
      .executeTakeFirst();

    if (!inserted) {
      const existing = await transaction
        .selectFrom("livekit_participant_webhook_receipt")
        .select([
          "id",
          "eventType",
          "payloadDigest",
          "providerRoomSid",
          "providerRoomName",
          "providerParticipantSid",
          "participantIdentityDigest",
        ])
        .where("providerEnvironment", "=", event.providerEnvironment)
        .where("providerEventId", "=", event.providerEventId)
        .executeTakeFirstOrThrow();
      if (
        existing.eventType !== eventType ||
        existing.payloadDigest !== event.payloadDigest ||
        existing.providerRoomSid !== roomSid ||
        existing.providerRoomName !== roomName ||
        existing.providerParticipantSid !== participantSid ||
        existing.participantIdentityDigest !== participantIdentityDigest
      )
        throw new TypeError("Webhook event identity was reused");
      return { status: "duplicate", receiptId: existing.id };
    }

    const room = await transaction
      .selectFrom("event_virtual_room")
      .select(["id", "eventSessionId", "generation", "providerRoomSid"])
      .where("provider", "=", "livekit")
      .where("providerRoomName", "=", roomName)
      .forUpdate()
      .executeTakeFirst();
    if (!room || (room.providerRoomSid && room.providerRoomSid !== roomSid)) {
      await transaction
        .updateTable("livekit_participant_webhook_receipt")
        .set({ processingState: "unmatched", processedAt: receivedAt })
        .where("id", "=", receiptId)
        .executeTakeFirstOrThrow();
      return { status: "unmatched", receiptId };
    }
    if (!room.providerRoomSid)
      await transaction
        .updateTable("event_virtual_room")
        .set({ providerRoomSid: roomSid })
        .where("id", "=", room.id)
        .where("providerRoomSid", "is", null)
        .executeTakeFirstOrThrow();

    if (!isEventVirtualAttendeeIdentity(participantIdentity)) {
      await transaction
        .updateTable("livekit_participant_webhook_receipt")
        .set({ processingState: "ignored", processedAt: receivedAt })
        .where("id", "=", receiptId)
        .executeTakeFirstOrThrow();
      return { status: "ignored", receiptId };
    }

    const lobbyEntries = await transaction
      .selectFrom("event_virtual_join_access as access")
      .innerJoin(
        "event_virtual_lobby_entry as lobby",
        "lobby.eventVirtualJoinAccessId",
        "access.id",
      )
      .select([
        "lobby.id",
        "lobby.eventVirtualJoinAccessId",
        "lobby.eventOccurrenceId",
        "lobby.eventSessionId",
        "lobby.roomGeneration",
        "lobby.eventParticipationId",
        "lobby.state",
        "lobby.firstConnectedAt",
        "lobby.lastSeenAt",
        "lobby.leftAt",
        "lobby.updatedAt",
      ])
      .where("access.eventSessionId", "=", room.eventSessionId)
      .where("access.roomGeneration", "=", room.generation)
      .forUpdate("lobby")
      .execute();
    const lobbyEntry = lobbyEntries.find(
      (entry) =>
        eventVirtualAttendeeIdentity(room.id, entry.eventParticipationId) ===
        participantIdentity,
    );
    if (!lobbyEntry) {
      await transaction
        .updateTable("livekit_participant_webhook_receipt")
        .set({ processingState: "unmatched", processedAt: receivedAt })
        .where("id", "=", receiptId)
        .executeTakeFirstOrThrow();
      return { status: "unmatched", receiptId };
    }

    await transaction
      .updateTable("livekit_participant_webhook_receipt")
      .set({
        processingState: "processed",
        processedAt: receivedAt,
        matchedRoomId: room.id,
        matchedLobbyEntryId: lobbyEntry.id,
        matchedEventVirtualJoinAccessId: lobbyEntry.eventVirtualJoinAccessId,
        matchedEventOccurrenceId: lobbyEntry.eventOccurrenceId,
        matchedEventSessionId: lobbyEntry.eventSessionId,
        matchedRoomGeneration: lobbyEntry.roomGeneration,
        matchedEventParticipationId: lobbyEntry.eventParticipationId,
      })
      .where("id", "=", receiptId)
      .executeTakeFirstOrThrow();

    const existingInterval = await transaction
      .selectFrom("event_virtual_connection_interval")
      .select([
        "id",
        "lobbyEntryId",
        "participantIdentityDigest",
        "joinedAt",
        "leftAt",
        "createdAt",
      ])
      .where("roomId", "=", room.id)
      .where("providerParticipantSid", "=", participantSid)
      .forUpdate()
      .executeTakeFirst();
    if (
      existingInterval &&
      (existingInterval.lobbyEntryId !== lobbyEntry.id ||
        existingInterval.participantIdentityDigest !==
          participantIdentityDigest)
    )
      throw new TypeError("Provider participant identity was reused");

    if (eventType === "participant_joined" && !existingInterval) {
      const terminalReceipt = await transaction
        .selectFrom("livekit_participant_webhook_receipt")
        .select(["id", "providerCreatedAt"])
        .where("matchedRoomId", "=", room.id)
        .where("matchedLobbyEntryId", "=", lobbyEntry.id)
        .where("providerParticipantSid", "=", participantSid)
        .where("eventType", "in", [
          "participant_left",
          "participant_connection_aborted",
        ])
        .where("providerCreatedAt", ">=", providerCreatedAt)
        .where("processingState", "=", "processed")
        .orderBy("providerCreatedAt")
        .orderBy("id")
        .executeTakeFirst();
      await transaction
        .insertInto("event_virtual_connection_interval")
        .values({
          id: `event_virtual_connection_interval_${randomUUID()}`,
          roomId: room.id,
          eventVirtualJoinAccessId: lobbyEntry.eventVirtualJoinAccessId,
          eventOccurrenceId: lobbyEntry.eventOccurrenceId,
          eventSessionId: lobbyEntry.eventSessionId,
          roomGeneration: lobbyEntry.roomGeneration,
          lobbyEntryId: lobbyEntry.id,
          eventParticipationId: lobbyEntry.eventParticipationId,
          providerParticipantSid: participantSid,
          participantIdentityDigest,
          joinedReceiptId: receiptId,
          leftReceiptId: terminalReceipt?.id ?? null,
          joinedAt: providerCreatedAt,
          leftAt: terminalReceipt?.providerCreatedAt ?? null,
          createdAt: receivedAt,
          updatedAt: receivedAt,
        })
        .executeTakeFirstOrThrow();
    } else if (
      eventType !== "participant_joined" &&
      existingInterval &&
      !existingInterval.leftAt &&
      providerCreatedAt >= existingInterval.joinedAt
    ) {
      await transaction
        .updateTable("event_virtual_connection_interval")
        .set({
          leftReceiptId: receiptId,
          leftAt: providerCreatedAt,
          updatedAt: new Date(
            Math.max(
              receivedAt.getTime(),
              existingInterval.createdAt.getTime(),
            ),
          ),
        })
        .where("id", "=", existingInterval.id)
        .where("leftAt", "is", null)
        .executeTakeFirstOrThrow();
    }

    await projectLobbyPresence(transaction, lobbyEntry, receivedAt);
    return { status: "processed", receiptId, lobbyEntryId: lobbyEntry.id };
  });
}
