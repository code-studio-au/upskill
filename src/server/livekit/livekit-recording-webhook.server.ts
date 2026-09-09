import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { getServerEnv, type ServerEnv } from "#/server/env.server";
import { normalizeLiveKitRecordingEgressInfo } from "./livekit-recording-provider.cloud.server";
import type { VerifiedLiveKitWebhook } from "./livekit-webhook.server";

type EgressEventName = "egress_started" | "egress_updated" | "egress_ended";

function isEgressEventName(value: string): value is EgressEventName {
  return (
    value === "egress_started" ||
    value === "egress_updated" ||
    value === "egress_ended"
  );
}

export type LiveKitRecordingWebhookIngestionOutcome =
  | { status: "pending"; receiptId: string; recordingId: string }
  | { status: "duplicate"; receiptId: string }
  | { status: "unmatched"; receiptId: string }
  | { status: "unsupported" };

export async function ingestVerifiedLiveKitRecordingWebhook(
  event: VerifiedLiveKitWebhook,
  database: Kysely<Database> = getDatabase(),
  environment: ServerEnv = getServerEnv(),
  clock: () => Date = () => new Date(),
): Promise<LiveKitRecordingWebhookIngestionOutcome> {
  const egressInfo = event.egressInfo;
  const egressId = event.egressId;
  const roomName = event.roomName;
  if (!isEgressEventName(event.event) || !egressInfo || !egressId || !roomName)
    return { status: "unsupported" };
  if (environment.LIVEKIT_PROJECT_ENVIRONMENT !== event.providerEnvironment)
    throw new TypeError("Webhook provider environment mismatch");
  const eventType = event.event;

  const providerCreatedAt = new Date(event.createdAtSeconds * 1_000);
  if (Number.isNaN(providerCreatedAt.getTime()))
    throw new RangeError("Provider webhook timestamp is invalid");
  const receivedAt = clock();
  if (Number.isNaN(receivedAt.getTime()))
    throw new RangeError("Webhook receipt timestamp is invalid");

  return database.transaction().execute(async (transaction) => {
    const receiptId = `livekit_webhook_receipt_${randomUUID()}`;
    const inserted = await transaction
      .insertInto("livekit_webhook_receipt")
      .values({
        id: receiptId,
        provider: "livekit",
        providerEnvironment: event.providerEnvironment,
        providerEventId: event.providerEventId,
        eventType,
        payloadDigest: event.payloadDigest,
        providerCreatedAt,
        receivedAt,
        processingState: "processing",
        processingAttempts: 0,
        lastAttemptAt: null,
        processedAt: null,
        lastErrorCode: null,
        matchedRecordingId: null,
        matchedRoomId: null,
        providerEgressId: egressId,
        providerRoomName: roomName,
        normalizedStatus: null,
        startedAt: null,
        endedAt: null,
        fileSizeBytes: null,
        durationNanoseconds: null,
        failureCode: null,
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
        .selectFrom("livekit_webhook_receipt")
        .select([
          "id",
          "eventType",
          "payloadDigest",
          "providerEgressId",
          "providerRoomName",
        ])
        .where("providerEnvironment", "=", event.providerEnvironment)
        .where("providerEventId", "=", event.providerEventId)
        .executeTakeFirstOrThrow();
      if (
        existing.eventType !== eventType ||
        existing.payloadDigest !== event.payloadDigest ||
        existing.providerEgressId !== egressId ||
        existing.providerRoomName !== roomName
      )
        throw new TypeError("Webhook event identity was reused");
      return { status: "duplicate", receiptId: existing.id };
    }

    const recording = await transaction
      .selectFrom("event_virtual_recording as recording")
      .innerJoin("event_virtual_room as room", "room.id", "recording.roomId")
      .select([
        "recording.id",
        "recording.roomId",
        "recording.providerEgressId",
        "recording.storageObjectKey",
      ])
      .where("recording.provider", "=", "livekit")
      .where("room.providerRoomName", "=", roomName)
      .where((expression) =>
        expression.or([
          expression("recording.providerEgressId", "=", egressId),
          expression("recording.providerEgressId", "is", null),
        ]),
      )
      .forUpdate("recording")
      .executeTakeFirst();

    if (!recording) {
      await transaction
        .updateTable("livekit_webhook_receipt")
        .set({ processingState: "unmatched", processedAt: receivedAt })
        .where("id", "=", receiptId)
        .executeTakeFirstOrThrow();
      return { status: "unmatched", receiptId };
    }

    const snapshot = normalizeLiveKitRecordingEgressInfo(
      egressInfo,
      roomName,
      {
        bucket: environment.S3_RECORDING_BUCKET,
        region: environment.AWS_REGION,
      },
      egressId,
      recording.storageObjectKey,
    );
    await transaction
      .updateTable("livekit_webhook_receipt")
      .set({
        processingState: "pending",
        matchedRecordingId: recording.id,
        matchedRoomId: recording.roomId,
        normalizedStatus: snapshot.status,
        startedAt: snapshot.startedAt,
        endedAt: snapshot.endedAt,
        fileSizeBytes: snapshot.output?.fileSizeBytes ?? null,
        durationNanoseconds: snapshot.output?.durationNanoseconds ?? null,
        failureCode: snapshot.failureCode,
      })
      .where("id", "=", receiptId)
      .executeTakeFirstOrThrow();
    return { status: "pending", receiptId, recordingId: recording.id };
  });
}
