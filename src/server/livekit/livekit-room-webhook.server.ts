import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { getServerEnv, type ServerEnv } from "#/server/env.server";
import { applyLiveKitRoomLifecycleEvent } from "#/server/events/event-virtual-room.server";
import type { VerifiedLiveKitWebhook } from "./livekit-webhook.server";

type RoomEventName = "room_started" | "room_finished";

function isRoomEventName(value: string): value is RoomEventName {
  return value === "room_started" || value === "room_finished";
}

export type LiveKitRoomWebhookIngestionOutcome =
  | {
      status: "processed" | "ignored";
      receiptId: string;
      roomId: string;
    }
  | { status: "duplicate" | "unmatched"; receiptId: string }
  | { status: "unsupported" };

export async function ingestVerifiedLiveKitRoomWebhook(
  event: VerifiedLiveKitWebhook,
  database: Kysely<Database> = getDatabase(),
  environment: ServerEnv = getServerEnv(),
  clock: () => Date = () => new Date(),
): Promise<LiveKitRoomWebhookIngestionOutcome> {
  const roomSid = event.roomSid;
  const roomName = event.roomName;
  if (!isRoomEventName(event.event) || !roomSid || !roomName)
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

  return database.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(
      ${`${event.providerEnvironment}:${event.providerEventId}`}, 0
    ))`.execute(transaction);
    const [recordingReceipt, participantReceipt] = await Promise.all([
      transaction
        .selectFrom("livekit_webhook_receipt")
        .select("id")
        .where("providerEnvironment", "=", event.providerEnvironment)
        .where("providerEventId", "=", event.providerEventId)
        .executeTakeFirst(),
      transaction
        .selectFrom("livekit_participant_webhook_receipt")
        .select("id")
        .where("providerEnvironment", "=", event.providerEnvironment)
        .where("providerEventId", "=", event.providerEventId)
        .executeTakeFirst(),
    ]);
    if (recordingReceipt || participantReceipt)
      throw new TypeError("Webhook event identity was reused");

    const receiptId = `livekit_room_webhook_receipt_${randomUUID()}`;
    const inserted = await transaction
      .insertInto("livekit_room_webhook_receipt")
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
        processingState: "processing",
        processedAt: null,
        matchedRoomId: null,
        matchedEventSessionId: null,
        matchedRoomGeneration: null,
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
        .selectFrom("livekit_room_webhook_receipt")
        .select([
          "id",
          "eventType",
          "payloadDigest",
          "providerRoomSid",
          "providerRoomName",
        ])
        .where("providerEnvironment", "=", event.providerEnvironment)
        .where("providerEventId", "=", event.providerEventId)
        .executeTakeFirstOrThrow();
      if (
        existing.eventType !== eventType ||
        existing.payloadDigest !== event.payloadDigest ||
        existing.providerRoomSid !== roomSid ||
        existing.providerRoomName !== roomName
      )
        throw new TypeError("Webhook event identity was reused");
      return { status: "duplicate", receiptId: existing.id };
    }

    const outcome = await applyLiveKitRoomLifecycleEvent(transaction, {
      event: eventType,
      providerRoomName: roomName,
      providerRoomSid: roomSid,
      observedAt: receivedAt,
    });
    await transaction
      .updateTable("livekit_room_webhook_receipt")
      .set({
        processingState: outcome.status,
        processedAt: receivedAt,
        ...(outcome.status === "unmatched"
          ? {}
          : {
              matchedRoomId: outcome.roomId,
              matchedEventSessionId: outcome.eventSessionId,
              matchedRoomGeneration: outcome.generation,
            }),
      })
      .where("id", "=", receiptId)
      .executeTakeFirstOrThrow();
    return outcome.status === "unmatched"
      ? { status: "unmatched", receiptId }
      : { status: outcome.status, receiptId, roomId: outcome.roomId };
  });
}
