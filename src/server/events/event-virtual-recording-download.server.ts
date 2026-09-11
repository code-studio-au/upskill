import "@tanstack/react-start/server-only";

import type { AuthenticatedUser } from "#/server/auth/session.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { createPresignedObjectDownload } from "#/server/storage/object-storage.server";

const RECORDING_DOWNLOAD_EXPIRY_SECONDS = 60;

type RecordingDownloadSigner = typeof createPresignedObjectDownload;

export type EventVirtualRecordingDownloadResult =
  | { status: "ready"; url: string; expiresAt: string }
  | { status: "forbidden" | "not-found" }
  | { status: "conflict"; reason: "recording_unavailable" };

export async function issueEventVirtualRecordingDownload(
  input: { eventOccurrenceId: string; recordingId: string },
  user: AuthenticatedUser,
  options: {
    now?: Date;
    signDownload?: RecordingDownloadSigner;
  } = {},
): Promise<EventVirtualRecordingDownloadResult> {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime()))
    throw new RangeError("Recording download time is invalid");
  const signDownload = options.signDownload ?? createPresignedObjectDownload;
  const database = getDatabase();
  return database.transaction().execute(async (transaction) => {
    const administrator = await transaction
      .selectFrom("platform_admin")
      .select("userId")
      .where("userId", "=", user.id)
      .forShare()
      .executeTakeFirst();
    if (!administrator) return { status: "forbidden" };
    const recording = await transaction
      .selectFrom("event_virtual_recording as recording")
      .innerJoin(
        "event_session as session",
        "session.id",
        "recording.eventSessionId",
      )
      .select([
        "recording.id",
        "recording.roomId",
        "recording.eventSessionId",
        "recording.roomGeneration",
        "recording.status",
        "recording.storageObjectKey",
        "recording.retentionDeadline",
      ])
      .where("recording.id", "=", input.recordingId)
      .where("session.eventOccurrenceId", "=", input.eventOccurrenceId)
      .forShare("recording")
      .executeTakeFirst();
    if (!recording) return { status: "not-found" };
    if (
      recording.status !== "complete" ||
      !recording.retentionDeadline ||
      recording.retentionDeadline <= now
    )
      return { status: "conflict", reason: "recording_unavailable" };
    const remainingRetentionSeconds = Math.floor(
      (recording.retentionDeadline.getTime() - now.getTime()) / 1_000,
    );
    if (remainingRetentionSeconds < 1)
      return { status: "conflict", reason: "recording_unavailable" };
    const expiresInSeconds = Math.min(
      RECORDING_DOWNLOAD_EXPIRY_SECONDS,
      remainingRetentionSeconds,
    );
    const expiresAt = new Date(now.getTime() + expiresInSeconds * 1_000);
    const url = await signDownload({
      bucket: getServerEnv().S3_RECORDING_BUCKET,
      key: recording.storageObjectKey,
      expiresInSeconds,
      signingDate: now,
    });
    await recordDurableAuditEvent(transaction, {
      actorUserId: user.id,
      action: "event_virtual_recording.download_issued",
      subjectType: "event_virtual_recording",
      subjectId: recording.id,
      aggregateId: recording.roomId,
      metadata: {
        roomId: recording.roomId,
        eventSessionId: recording.eventSessionId,
        roomGeneration: recording.roomGeneration,
        accessMode: "download",
        expiresAt: expiresAt.toISOString(),
      },
      createdAt: now,
    });
    return { status: "ready", url, expiresAt: expiresAt.toISOString() };
  });
}
