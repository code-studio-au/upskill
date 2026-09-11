import "@tanstack/react-start/server-only";

import type { Kysely, Transaction } from "kysely";
import type { Database } from "#/server/db/types";

type DatabaseConnection = Kysely<Database> | Transaction<Database>;

interface EventVirtualRecordingAccessTarget {
  id: string;
  roomId: string;
  eventSessionId: string;
  roomGeneration: number;
  storageObjectKey: string;
  retentionDeadline: Date;
}

export type EventVirtualRecordingAccessResult =
  | { status: "ready"; target: EventVirtualRecordingAccessTarget }
  | { status: "forbidden" | "not-found" }
  | { status: "conflict"; reason: "recording_unavailable" };

export async function findEventVirtualRecordingAccess(
  database: DatabaseConnection,
  input: { eventOccurrenceId: string; recordingId: string },
  userId: string,
  now: Date,
  lock: false | "share" | "update" = false,
): Promise<EventVirtualRecordingAccessResult> {
  let administratorQuery = database
    .selectFrom("platform_admin")
    .select("userId")
    .where("userId", "=", userId);
  if (lock) administratorQuery = administratorQuery.forShare();
  const administrator = await administratorQuery.executeTakeFirst();
  if (!administrator) return { status: "forbidden" };

  let recordingQuery = database
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
    .where("session.eventOccurrenceId", "=", input.eventOccurrenceId);
  if (lock === "share") recordingQuery = recordingQuery.forShare("recording");
  if (lock === "update") recordingQuery = recordingQuery.forUpdate("recording");
  const recording = await recordingQuery.executeTakeFirst();
  if (!recording) return { status: "not-found" };
  if (
    recording.status !== "complete" ||
    !recording.retentionDeadline ||
    recording.retentionDeadline <= now
  )
    return { status: "conflict", reason: "recording_unavailable" };
  return {
    status: "ready",
    target: {
      id: recording.id,
      roomId: recording.roomId,
      eventSessionId: recording.eventSessionId,
      roomGeneration: recording.roomGeneration,
      storageObjectKey: recording.storageObjectKey,
      retentionDeadline: recording.retentionDeadline,
    },
  };
}
