import "@tanstack/react-start/server-only";

import type { AuthenticatedUser } from "#/server/auth/session.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import { findEventVirtualRecordingAccess } from "./event-virtual-recording-access.server";

const PLAYBACK_IDLE_EXPIRY_MILLISECONDS = 10 * 60_000;

export type EventVirtualRecordingPlaybackAccessResult =
  | { status: "ready"; target: { storageObjectKey: string } }
  | { status: "forbidden" | "not-found" }
  | { status: "conflict"; reason: "recording_unavailable" };

function playbackExpiry(now: Date, retentionDeadline: Date): Date {
  return new Date(
    Math.min(
      now.getTime() + PLAYBACK_IDLE_EXPIRY_MILLISECONDS,
      retentionDeadline.getTime(),
    ),
  );
}

export async function accessEventVirtualRecordingPlayback(
  input: { eventOccurrenceId: string; recordingId: string },
  user: AuthenticatedUser,
  now = new Date(),
): Promise<EventVirtualRecordingPlaybackAccessResult> {
  if (Number.isNaN(now.getTime()))
    throw new RangeError("Recording playback time is invalid");
  const database = getDatabase();
  return database.transaction().execute(async (transaction) => {
    const access = await findEventVirtualRecordingAccess(
      transaction,
      input,
      user.id,
      now,
      "update",
    );
    if (access.status !== "ready") return access;
    const recording = access.target;
    const expiresAt = playbackExpiry(now, recording.retentionDeadline);
    const session = await transaction
      .selectFrom("event_virtual_recording_playback_session")
      .select("expiresAt")
      .where("recordingId", "=", recording.id)
      .where("userId", "=", user.id)
      .forUpdate()
      .executeTakeFirst();
    const newSession = !session || session.expiresAt <= now;
    if (session)
      await transaction
        .updateTable("event_virtual_recording_playback_session")
        .set({
          expiresAt,
          lastUsedAt: now,
          ...(newSession ? { createdAt: now } : {}),
        })
        .where("recordingId", "=", recording.id)
        .where("userId", "=", user.id)
        .executeTakeFirstOrThrow();
    else
      await transaction
        .insertInto("event_virtual_recording_playback_session")
        .values({
          recordingId: recording.id,
          userId: user.id,
          expiresAt,
          lastUsedAt: now,
          createdAt: now,
        })
        .execute();
    if (newSession)
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: "event_virtual_recording.playback_issued",
        subjectType: "event_virtual_recording",
        subjectId: recording.id,
        aggregateId: recording.roomId,
        metadata: {
          roomId: recording.roomId,
          eventSessionId: recording.eventSessionId,
          roomGeneration: recording.roomGeneration,
          accessMode: "application_playback",
          idleExpiresAt: expiresAt.toISOString(),
        },
        createdAt: now,
      });
    return {
      status: "ready",
      target: { storageObjectKey: recording.storageObjectKey },
    };
  });
}
