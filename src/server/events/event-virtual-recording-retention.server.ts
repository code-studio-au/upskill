import "@tanstack/react-start/server-only";

import { sql, type Selectable, type Transaction } from "kysely";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { deleteVersionedObject } from "#/server/storage/object-storage.server";

const DELETION_LEASE_MILLISECONDS = 5 * 60_000;
const DELETION_RETRY_DELAY_MILLISECONDS = 30_000;
const DELETION_MAXIMUM_AUTOMATIC_ATTEMPTS = 5;

type RecordingDeletion = Selectable<
  Database["event_virtual_recording_deletion"]
>;

export type EventVirtualRecordingDeletionMutationResult =
  | { status: "ready" }
  | { status: "forbidden" | "not-found" }
  | { status: "conflict"; reason: "invalid_transition" };

type CompletedRecordingDeletionOutcome = {
  status: "deleted" | "failed";
  recordingId: string;
  attempt: number;
  reason: RecordingDeletion["reason"];
};

type RecordingDeletionOutcome =
  | CompletedRecordingDeletionOutcome
  | { status: "no-work" }
  | { status: "stale" };

export interface EventVirtualRecordingDeletionBatch {
  outcomes: Array<CompletedRecordingDeletionOutcome>;
  limitReached: boolean;
}

type DeleteStoredRecording = (bucket: string, key: string) => Promise<void>;

function assertValidTime(now: Date): void {
  if (Number.isNaN(now.getTime()))
    throw new RangeError("Recording deletion time is invalid");
}

async function isPlatformAdministrator(
  transaction: Transaction<Database>,
  userId: string,
): Promise<boolean> {
  return Boolean(
    await transaction
      .selectFrom("platform_admin")
      .select("userId")
      .where("userId", "=", userId)
      .forShare()
      .executeTakeFirst(),
  );
}

async function findRecordingForDeletion(
  transaction: Transaction<Database>,
  input: { eventOccurrenceId: string; recordingId: string },
) {
  return transaction
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
      "recording.completedAt",
    ])
    .where("recording.id", "=", input.recordingId)
    .where("session.eventOccurrenceId", "=", input.eventOccurrenceId)
    .forUpdate("recording")
    .executeTakeFirst();
}

async function recordDeletionRequestAudit(
  transaction: Transaction<Database>,
  input: {
    action:
      | "event_virtual_recording.deletion_requested"
      | "event_virtual_recording.deletion_retried";
    actorUserId: string | null;
    recording: {
      id: string;
      roomId: string;
      eventSessionId: string;
      roomGeneration: number;
    };
    reason: RecordingDeletion["reason"];
    createdAt: Date;
  },
): Promise<void> {
  await recordDurableAuditEvent(transaction, {
    actorUserId: input.actorUserId,
    action: input.action,
    subjectType: "event_virtual_recording",
    subjectId: input.recording.id,
    aggregateId: input.recording.roomId,
    reasonCode: input.reason,
    metadata: {
      roomId: input.recording.roomId,
      eventSessionId: input.recording.eventSessionId,
      roomGeneration: input.recording.roomGeneration,
      deletionReason: input.reason,
    },
    createdAt: input.createdAt,
  });
}

export async function requestEventVirtualRecordingDeletion(
  input: { eventOccurrenceId: string; recordingId: string },
  user: AuthenticatedUser,
  now = new Date(),
): Promise<EventVirtualRecordingDeletionMutationResult> {
  assertValidTime(now);
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      if (!(await isPlatformAdministrator(transaction, user.id)))
        return { status: "forbidden" } as const;
      const recording = await findRecordingForDeletion(transaction, input);
      if (!recording) return { status: "not-found" } as const;
      if (recording.status === "deleted") return { status: "ready" } as const;
      if (recording.status !== "complete" && recording.status !== "failed")
        return {
          status: "conflict",
          reason: "invalid_transition",
        } as const;
      if (!recording.completedAt || recording.completedAt > now)
        return {
          status: "conflict",
          reason: "invalid_transition",
        } as const;
      const existing = await transaction
        .selectFrom("event_virtual_recording_deletion")
        .select(["status"])
        .where("recordingId", "=", recording.id)
        .forUpdate()
        .executeTakeFirst();
      if (existing)
        return existing.status === "failed"
          ? ({ status: "conflict", reason: "invalid_transition" } as const)
          : ({ status: "ready" } as const);
      await transaction
        .insertInto("event_virtual_recording_deletion")
        .values({
          recordingId: recording.id,
          reason: "administrator_requested",
          requestedByUserId: user.id,
          status: "pending",
          attempts: 0,
          availableAt: now,
          leasedUntil: null,
          lastAttemptAt: null,
          completedAt: null,
          lastErrorCode: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      await transaction
        .deleteFrom("event_virtual_recording_playback_session")
        .where("recordingId", "=", recording.id)
        .execute();
      await recordDeletionRequestAudit(transaction, {
        action: "event_virtual_recording.deletion_requested",
        actorUserId: user.id,
        recording,
        reason: "administrator_requested",
        createdAt: now,
      });
      return { status: "ready" } as const;
    });
}

export async function retryEventVirtualRecordingDeletion(
  input: { eventOccurrenceId: string; recordingId: string },
  user: AuthenticatedUser,
  now = new Date(),
): Promise<EventVirtualRecordingDeletionMutationResult> {
  assertValidTime(now);
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      if (!(await isPlatformAdministrator(transaction, user.id)))
        return { status: "forbidden" } as const;
      const recording = await findRecordingForDeletion(transaction, input);
      if (!recording) return { status: "not-found" } as const;
      const deletion = await transaction
        .selectFrom("event_virtual_recording_deletion")
        .select(["status", "reason"])
        .where("recordingId", "=", recording.id)
        .forUpdate()
        .executeTakeFirst();
      if (!deletion || deletion.status !== "failed")
        return {
          status: "conflict",
          reason: "invalid_transition",
        } as const;
      await transaction
        .updateTable("event_virtual_recording_deletion")
        .set({
          status: "pending",
          availableAt: now,
          leasedUntil: null,
          completedAt: null,
          updatedAt: now,
        })
        .where("recordingId", "=", recording.id)
        .where("status", "=", "failed")
        .executeTakeFirstOrThrow();
      await recordDeletionRequestAudit(transaction, {
        action: "event_virtual_recording.deletion_retried",
        actorUserId: user.id,
        recording,
        reason: deletion.reason,
        createdAt: now,
      });
      return { status: "ready" } as const;
    });
}

async function scheduleExpiredRecordingDeletions(
  now: Date,
  limit: number,
): Promise<void> {
  const database = getDatabase();
  const due = await database
    .selectFrom("event_virtual_recording as recording")
    .select([
      "recording.id",
      "recording.roomId",
      "recording.eventSessionId",
      "recording.roomGeneration",
    ])
    .where("recording.status", "in", ["complete", "failed"])
    .where((expression) =>
      expression.not(
        expression.exists(
          expression
            .selectFrom("event_virtual_recording_deletion as deletion")
            .select("deletion.recordingId")
            .whereRef("deletion.recordingId", "=", "recording.id"),
        ),
      ),
    )
    .where(
      sql<boolean>`case
        when "recording".status = 'complete'
          then "recording"."retentionDeadline" <= ${now}
        else "recording"."completedAt" + "recording"."retentionDays" * interval '24 hours' <= ${now}
      end`,
    )
    .orderBy("recording.completedAt")
    .orderBy("recording.id")
    .limit(limit)
    .execute();
  for (const candidate of due)
    await database.transaction().execute(async (transaction) => {
      const recording = await transaction
        .selectFrom("event_virtual_recording")
        .select(["id", "roomId", "eventSessionId", "roomGeneration", "status"])
        .where("id", "=", candidate.id)
        .forUpdate()
        .executeTakeFirst();
      if (!recording || !["complete", "failed"].includes(recording.status))
        return;
      const inserted = await transaction
        .insertInto("event_virtual_recording_deletion")
        .values({
          recordingId: recording.id,
          reason: "retention_expired",
          requestedByUserId: null,
          status: "pending",
          attempts: 0,
          availableAt: now,
          leasedUntil: null,
          lastAttemptAt: null,
          completedAt: null,
          lastErrorCode: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflict((conflict) => conflict.column("recordingId").doNothing())
        .returning("recordingId")
        .executeTakeFirst();
      if (!inserted) return;
      await transaction
        .deleteFrom("event_virtual_recording_playback_session")
        .where("recordingId", "=", recording.id)
        .execute();
      await recordDeletionRequestAudit(transaction, {
        action: "event_virtual_recording.deletion_requested",
        actorUserId: null,
        recording,
        reason: "retention_expired",
        createdAt: now,
      });
    });
}

function retryAt(now: Date, attempts: number): Date {
  return new Date(
    now.getTime() +
      DELETION_RETRY_DELAY_MILLISECONDS * 2 ** Math.min(attempts - 1, 6),
  );
}

async function processNextRecordingDeletion(options: {
  now: Date;
  getCurrentTime: () => Date;
  deleteStoredRecording: DeleteStoredRecording;
}): Promise<RecordingDeletionOutcome> {
  const database = getDatabase();
  const claimed = await database.transaction().execute(async (transaction) => {
    const deletion = await transaction
      .selectFrom("event_virtual_recording_deletion as deletion")
      .innerJoin(
        "event_virtual_recording as recording",
        "recording.id",
        "deletion.recordingId",
      )
      .select([
        "deletion.recordingId",
        "deletion.reason",
        "deletion.status",
        "deletion.attempts",
        "recording.storageObjectKey",
      ])
      .where((expression) =>
        expression.or([
          expression.and([
            expression("deletion.status", "=", "pending"),
            expression("deletion.availableAt", "<=", options.now),
          ]),
          expression.and([
            expression("deletion.status", "=", "failed"),
            expression(
              "deletion.attempts",
              "<",
              DELETION_MAXIMUM_AUTOMATIC_ATTEMPTS,
            ),
            expression("deletion.availableAt", "<=", options.now),
          ]),
          expression.and([
            expression("deletion.status", "=", "processing"),
            expression("deletion.leasedUntil", "<=", options.now),
          ]),
        ]),
      )
      .orderBy("deletion.availableAt")
      .orderBy("deletion.createdAt")
      .orderBy("deletion.recordingId")
      .forUpdate("deletion")
      .skipLocked()
      .executeTakeFirst();
    if (!deletion) return null;
    const attempt = deletion.attempts + 1;
    await transaction
      .updateTable("event_virtual_recording_deletion")
      .set({
        status: "processing",
        attempts: attempt,
        leasedUntil: new Date(
          options.now.getTime() + DELETION_LEASE_MILLISECONDS,
        ),
        lastAttemptAt: options.now,
        completedAt: null,
        lastErrorCode: null,
        updatedAt: options.now,
      })
      .where("recordingId", "=", deletion.recordingId)
      .executeTakeFirstOrThrow();
    return { ...deletion, attempt };
  });
  if (!claimed) return { status: "no-work" };

  try {
    await options.deleteStoredRecording(
      getServerEnv().S3_RECORDING_BUCKET,
      claimed.storageObjectKey,
    );
  } catch (error) {
    const failedAt = options.getCurrentTime();
    assertValidTime(failedAt);
    logServerEvent({
      level: "error",
      event: "event_virtual_recording.deletion_failed",
      error,
      fields: {
        entityType: "event_virtual_recording",
        entityId: claimed.recordingId,
        attempt: claimed.attempt,
        reason: claimed.reason,
      },
    });
    const failed = await database
      .updateTable("event_virtual_recording_deletion")
      .set({
        status: "failed",
        availableAt: retryAt(failedAt, claimed.attempt),
        leasedUntil: null,
        completedAt: null,
        lastErrorCode: "recording_storage_delete_failed",
        updatedAt: failedAt,
      })
      .where("recordingId", "=", claimed.recordingId)
      .where("status", "=", "processing")
      .where("attempts", "=", claimed.attempt)
      .returning("recordingId")
      .executeTakeFirst();
    if (!failed) return { status: "stale" };
    return {
      status: "failed",
      recordingId: claimed.recordingId,
      attempt: claimed.attempt,
      reason: claimed.reason,
    };
  }

  const completedAt = options.getCurrentTime();
  assertValidTime(completedAt);
  const completed = await database
    .transaction()
    .execute(async (transaction) => {
      const recording = await transaction
        .selectFrom("event_virtual_recording")
        .selectAll()
        .where("id", "=", claimed.recordingId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const deletion = await transaction
        .selectFrom("event_virtual_recording_deletion")
        .select(["status", "attempts", "requestedByUserId", "reason"])
        .where("recordingId", "=", claimed.recordingId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (
        deletion.status !== "processing" ||
        deletion.attempts !== claimed.attempt
      )
        return false;
      if (recording.status === "complete")
        await transaction
          .updateTable("event_virtual_recording")
          .set({
            status: "deleted",
            deletedByUserId: deletion.requestedByUserId,
            deletedAt: completedAt,
            deletionReason: deletion.reason,
            updatedAt: completedAt,
          })
          .where("id", "=", recording.id)
          .where("status", "=", "complete")
          .executeTakeFirstOrThrow();
      else if (recording.status !== "failed" && recording.status !== "deleted")
        throw new Error("Recording is no longer eligible for deletion");
      await transaction
        .deleteFrom("event_virtual_recording_playback_session")
        .where("recordingId", "=", recording.id)
        .execute();
      await transaction
        .updateTable("event_virtual_recording_deletion")
        .set({
          status: "succeeded",
          leasedUntil: null,
          completedAt,
          lastErrorCode: null,
          updatedAt: completedAt,
        })
        .where("recordingId", "=", recording.id)
        .where("status", "=", "processing")
        .where("attempts", "=", claimed.attempt)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: deletion.requestedByUserId,
        action: "event_virtual_recording.deleted",
        subjectType: "event_virtual_recording",
        subjectId: recording.id,
        aggregateId: recording.roomId,
        reasonCode: deletion.reason,
        metadata: {
          roomId: recording.roomId,
          eventSessionId: recording.eventSessionId,
          roomGeneration: recording.roomGeneration,
          deletionReason: deletion.reason,
          originalRecordingStatus: recording.status,
          attempt: claimed.attempt,
        },
        createdAt: completedAt,
      });
      return true;
    });
  if (!completed) return { status: "stale" };
  return {
    status: "deleted",
    recordingId: claimed.recordingId,
    attempt: claimed.attempt,
    reason: claimed.reason,
  };
}

export async function processAvailableEventVirtualRecordingDeletions(
  limit = 10,
  options: {
    now?: Date;
    getCurrentTime?: () => Date;
    deleteStoredRecording?: DeleteStoredRecording;
  } = {},
): Promise<EventVirtualRecordingDeletionBatch> {
  const now = options.now ?? new Date();
  const getCurrentTime = options.getCurrentTime ?? (() => new Date());
  assertValidTime(now);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("Recording deletion batch limit is invalid");
  await scheduleExpiredRecordingDeletions(now, limit);
  const outcomes: EventVirtualRecordingDeletionBatch["outcomes"] = [];
  for (let index = 0; index < limit; index += 1) {
    const outcome = await processNextRecordingDeletion({
      now,
      getCurrentTime,
      deleteStoredRecording:
        options.deleteStoredRecording ?? deleteVersionedObject,
    });
    if (outcome.status === "no-work") break;
    if (outcome.status === "stale") continue;
    outcomes.push(outcome);
  }
  return { outcomes, limitReached: outcomes.length === limit };
}
