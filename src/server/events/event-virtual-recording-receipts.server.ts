import "@tanstack/react-start/server-only";

import { type Selectable, type Transaction, type Updateable } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";

const RECEIPT_RETRY_DELAY_MILLISECONDS = 30_000;
const RECEIPT_MAXIMUM_ATTEMPTS = 5;

type RecordingReceipt = Selectable<Database["livekit_webhook_receipt"]>;
type Recording = Selectable<Database["event_virtual_recording"]>;
type RecordingUpdate = Updateable<Database["event_virtual_recording"]>;

type RecordingOperation = Pick<
  Selectable<Database["event_virtual_room_operation"]>,
  | "id"
  | "kind"
  | "requestedByUserId"
  | "createdAt"
  | "recordingStopDispatchedAt"
>;

type LiveKitRecordingReceiptOutcome =
  | {
      status: "processed";
      receiptId: string;
      recordingId: string;
    }
  | {
      status: "failed";
      receiptId: string;
      recordingId: string;
      reasonCode: string;
    }
  | { status: "no-work" };

export interface LiveKitRecordingReceiptBatch {
  outcomes: Array<
    Exclude<LiveKitRecordingReceiptOutcome, { status: "no-work" }>
  >;
  limitReached: boolean;
}

function laterDate(...dates: Array<Date | null>): Date {
  return new Date(
    Math.max(
      ...dates.filter((date): date is Date => Boolean(date)).map(Number),
    ),
  );
}

function isTerminalRecording(status: Recording["status"]): boolean {
  return status === "complete" || status === "failed" || status === "deleted";
}

function datesMatch(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function datesContradict(left: Date | null, right: Date | null): boolean {
  return Boolean(left && right && !datesMatch(left, right));
}

function terminalReceiptConflict(
  recording: Recording,
  receipt: RecordingReceipt,
): string | null {
  if (!isTerminalRecording(recording.status)) return null;
  if (
    receipt.normalizedStatus !== "complete" &&
    receipt.normalizedStatus !== "failed"
  )
    return null;
  if (recording.status === "complete" || recording.status === "deleted") {
    if (
      receipt.normalizedStatus !== "complete" ||
      !datesMatch(recording.startedAt, receipt.startedAt) ||
      !datesMatch(recording.endedAt, receipt.endedAt) ||
      recording.fileSizeBytes !== receipt.fileSizeBytes ||
      recording.durationNanoseconds !== receipt.durationNanoseconds
    )
      return "recording_receipt_evidence_conflict";
    return null;
  }
  if (
    receipt.normalizedStatus !== "failed" ||
    datesContradict(recording.endedAt, receipt.endedAt) ||
    recording.failureCode !== receipt.failureCode
  )
    return "recording_receipt_evidence_conflict";
  return null;
}

function claimTime(receipt: RecordingReceipt, now: Date): Date {
  return new Date(
    Math.max(
      now.getTime(),
      receipt.receivedAt.getTime(),
      (receipt.lastAttemptAt?.getTime() ?? 0) + 1,
    ),
  );
}

async function recordLifecycleAudit(
  transaction: Transaction<Database>,
  input: {
    action:
      | "event_virtual_recording.completed"
      | "event_virtual_recording.failed"
      | "event_virtual_recording.started"
      | "event_virtual_recording.stop_started";
    actorUserId: string | null;
    recording: Recording;
    receipt: RecordingReceipt;
    status: Recording["status"];
    previousStatus: Recording["status"];
    createdAt: Date;
    reasonCode?: string;
  },
): Promise<void> {
  await recordDurableAuditEvent(transaction, {
    actorUserId: input.actorUserId,
    action: input.action,
    subjectType: "event_virtual_recording",
    subjectId: input.recording.id,
    aggregateId: input.recording.roomId,
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    metadata: {
      roomId: input.recording.roomId,
      eventSessionId: input.recording.eventSessionId,
      roomGeneration: input.recording.roomGeneration,
      status: input.status,
      previousStatus: input.previousStatus,
      providerStatus: input.receipt.normalizedStatus,
      evidenceSource: "livekit_webhook",
      receiptId: input.receipt.id,
    },
    createdAt: input.createdAt,
  });
}

async function finishReceipt(
  transaction: Transaction<Database>,
  receipt: RecordingReceipt,
  attemptedAt: Date,
  state: { status: "processed" } | { status: "failed"; reasonCode: string },
): Promise<Exclude<LiveKitRecordingReceiptOutcome, { status: "no-work" }>> {
  if (!receipt.matchedRecordingId)
    throw new TypeError("Processed recording receipt is not matched");
  const recordingId = receipt.matchedRecordingId;
  await transaction
    .updateTable("livekit_webhook_receipt")
    .set(
      state.status === "processed"
        ? {
            processingState: "processed",
            processedAt: attemptedAt,
            lastErrorCode: null,
          }
        : {
            processingState: "failed",
            processedAt: null,
            lastErrorCode: state.reasonCode,
          },
    )
    .where("id", "=", receipt.id)
    .where("processingState", "=", "processing")
    .where("processingAttempts", "=", receipt.processingAttempts + 1)
    .executeTakeFirstOrThrow();
  return state.status === "failed"
    ? {
        status: "failed",
        receiptId: receipt.id,
        recordingId,
        reasonCode: state.reasonCode,
      }
    : {
        status: "processed",
        receiptId: receipt.id,
        recordingId,
      };
}

function receiptConflict(
  recording: Recording,
  receipt: RecordingReceipt,
): string | null {
  const effectiveStartedAt = recording.startedAt ?? receipt.startedAt;
  if (isTerminalRecording(recording.status) && !recording.providerEgressId)
    return "recording_receipt_identity_conflict";
  if (
    recording.providerEgressId &&
    recording.providerEgressId !== receipt.providerEgressId
  )
    return "recording_receipt_identity_conflict";
  if (datesContradict(recording.startedAt, receipt.startedAt))
    return "recording_receipt_evidence_conflict";
  if (
    (receipt.startedAt && receipt.startedAt < recording.requestedAt) ||
    (receipt.endedAt && receipt.endedAt < recording.requestedAt) ||
    (receipt.endedAt &&
      effectiveStartedAt &&
      receipt.endedAt < effectiveStartedAt)
  )
    return "recording_receipt_timeline_invalid";
  return terminalReceiptConflict(recording, receipt);
}

function stopEvidence(
  recording: Recording,
  stopOperation: RecordingOperation | undefined,
): Pick<RecordingUpdate, "stopRequestedByUserId" | "stopRequestedAt"> | null {
  if (recording.stopRequestedByUserId && recording.stopRequestedAt)
    return {
      stopRequestedByUserId: recording.stopRequestedByUserId,
      stopRequestedAt: recording.stopRequestedAt,
    };
  if (stopOperation?.requestedByUserId)
    return {
      stopRequestedByUserId: stopOperation.requestedByUserId,
      stopRequestedAt: stopOperation.createdAt,
    };
  return null;
}

async function settleRecordingOperations(
  transaction: Transaction<Database>,
  operations: RecordingOperation[],
  terminal: boolean,
  completedAt: Date,
): Promise<void> {
  const operationIds = operations
    .filter((operation) => operation.kind === "start_recording" || terminal)
    .map((operation) => operation.id);
  if (!operationIds.length) return;
  await transaction
    .updateTable("event_virtual_room_operation")
    .set({
      status: "succeeded",
      leasedUntil: null,
      completedAt,
      lastErrorCode: null,
    })
    .where("id", "in", operationIds)
    .where("status", "in", ["pending", "processing"])
    .execute();
}

async function transitionRequestedRecording(
  transaction: Transaction<Database>,
  recording: Recording,
  receipt: RecordingReceipt,
  transitionAt: Date,
): Promise<void> {
  await transaction
    .updateTable("event_virtual_recording")
    .set({
      status: "starting",
      providerEgressId: receipt.providerEgressId,
      startedAt: receipt.startedAt,
      updatedAt: transitionAt,
    })
    .where("id", "=", recording.id)
    .executeTakeFirstOrThrow();
  await recordLifecycleAudit(transaction, {
    action: "event_virtual_recording.started",
    actorUserId: recording.requestedByUserId,
    recording,
    receipt,
    status: "starting",
    previousStatus: "requested",
    createdAt: transitionAt,
  });
}

async function applyTerminalReceipt(
  transaction: Transaction<Database>,
  recording: Recording,
  receipt: RecordingReceipt,
  stopOperation: RecordingOperation | undefined,
): Promise<void> {
  const normalizedStatus = receipt.normalizedStatus;
  if (normalizedStatus !== "complete" && normalizedStatus !== "failed")
    throw new TypeError("Terminal receipt status is required");
  const transitionAt = laterDate(
    recording.requestedAt,
    recording.updatedAt,
    receipt.receivedAt,
    receipt.startedAt,
    receipt.endedAt,
  );
  const startedTransition =
    recording.status === "requested" && Boolean(receipt.startedAt);
  if (startedTransition)
    await transitionRequestedRecording(
      transaction,
      recording,
      receipt,
      transitionAt,
    );
  const requestedStop = stopEvidence(recording, stopOperation);
  if (
    requestedStop &&
    !recording.stopRequestedAt &&
    stopOperation?.recordingStopDispatchedAt
  )
    await recordLifecycleAudit(transaction, {
      action: "event_virtual_recording.stop_started",
      actorUserId: stopOperation.requestedByUserId,
      recording,
      receipt,
      status: normalizedStatus,
      previousStatus: startedTransition ? "starting" : recording.status,
      createdAt: stopOperation.recordingStopDispatchedAt,
    });
  if (normalizedStatus === "complete") {
    if (
      !receipt.startedAt ||
      !receipt.endedAt ||
      receipt.fileSizeBytes === null ||
      receipt.durationNanoseconds === null
    )
      throw new TypeError("Completed receipt evidence is incomplete");
    await transaction
      .updateTable("event_virtual_recording")
      .set({
        status: "complete",
        providerEgressId: receipt.providerEgressId,
        startedAt: recording.startedAt ?? receipt.startedAt,
        ...(requestedStop ?? {}),
        endedAt: receipt.endedAt,
        completedAt: transitionAt,
        fileSizeBytes: receipt.fileSizeBytes,
        durationNanoseconds: receipt.durationNanoseconds,
        retentionDeadline: new Date(
          transitionAt.getTime() + recording.retentionDays * 24 * 60 * 60_000,
        ),
        failureCode: null,
        updatedAt: transitionAt,
      })
      .where("id", "=", recording.id)
      .executeTakeFirstOrThrow();
    await recordLifecycleAudit(transaction, {
      action: "event_virtual_recording.completed",
      actorUserId:
        stopOperation?.requestedByUserId ?? recording.requestedByUserId,
      recording,
      receipt,
      status: "complete",
      previousStatus: startedTransition ? "starting" : recording.status,
      createdAt: transitionAt,
    });
    return;
  }
  if (!receipt.failureCode)
    throw new TypeError("Failed receipt evidence is incomplete");
  await transaction
    .updateTable("event_virtual_recording")
    .set({
      status: "failed",
      providerEgressId: recording.providerEgressId ?? receipt.providerEgressId,
      startedAt: recording.startedAt ?? receipt.startedAt,
      ...(requestedStop ?? {}),
      endedAt: receipt.endedAt,
      completedAt: transitionAt,
      failureCode: receipt.failureCode,
      updatedAt: transitionAt,
    })
    .where("id", "=", recording.id)
    .executeTakeFirstOrThrow();
  await recordLifecycleAudit(transaction, {
    action: "event_virtual_recording.failed",
    actorUserId:
      stopOperation?.requestedByUserId ?? recording.requestedByUserId,
    recording,
    receipt,
    status: "failed",
    previousStatus: startedTransition ? "starting" : recording.status,
    reasonCode: receipt.failureCode,
    createdAt: transitionAt,
  });
}

async function applyNonterminalReceipt(
  transaction: Transaction<Database>,
  recording: Recording,
  receipt: RecordingReceipt,
  stopOperation: RecordingOperation | undefined,
): Promise<string | null> {
  const normalizedStatus = receipt.normalizedStatus;
  if (
    normalizedStatus !== "starting" &&
    normalizedStatus !== "active" &&
    normalizedStatus !== "stopping"
  )
    throw new TypeError("Nonterminal receipt status is required");
  if (recording.status === "stopping") return null;
  if (
    recording.status === "active" &&
    (normalizedStatus === "starting" || normalizedStatus === "active")
  )
    return null;
  const requestedStop =
    normalizedStatus === "stopping"
      ? stopEvidence(recording, stopOperation)
      : null;
  if (normalizedStatus === "stopping" && !requestedStop)
    return "recording_receipt_stop_unexpected";
  const transitionAt = laterDate(
    recording.requestedAt,
    recording.updatedAt,
    receipt.receivedAt,
    receipt.startedAt,
  );
  if (recording.status === "requested")
    await transitionRequestedRecording(
      transaction,
      recording,
      receipt,
      transitionAt,
    );
  if (normalizedStatus === "starting") {
    if (
      recording.status === "starting" &&
      !recording.startedAt &&
      receipt.startedAt
    )
      await transaction
        .updateTable("event_virtual_recording")
        .set({ startedAt: receipt.startedAt, updatedAt: transitionAt })
        .where("id", "=", recording.id)
        .executeTakeFirstOrThrow();
    return null;
  }
  if (normalizedStatus === "active") {
    await transaction
      .updateTable("event_virtual_recording")
      .set({
        status: "active",
        providerEgressId:
          recording.providerEgressId ?? receipt.providerEgressId,
        startedAt: recording.startedAt ?? receipt.startedAt,
        updatedAt: transitionAt,
      })
      .where("id", "=", recording.id)
      .executeTakeFirstOrThrow();
    return null;
  }
  await transaction
    .updateTable("event_virtual_recording")
    .set({
      status: "stopping",
      providerEgressId: recording.providerEgressId ?? receipt.providerEgressId,
      startedAt: recording.startedAt ?? receipt.startedAt,
      ...requestedStop,
      updatedAt: transitionAt,
    })
    .where("id", "=", recording.id)
    .executeTakeFirstOrThrow();
  if (!recording.stopRequestedAt && stopOperation?.recordingStopDispatchedAt)
    await recordLifecycleAudit(transaction, {
      action: "event_virtual_recording.stop_started",
      actorUserId: stopOperation.requestedByUserId,
      recording,
      receipt,
      status: "stopping",
      previousStatus:
        recording.status === "requested" ? "starting" : recording.status,
      createdAt: stopOperation.recordingStopDispatchedAt,
    });
  return null;
}

async function processNextLiveKitRecordingReceipt(
  now: Date,
): Promise<LiveKitRecordingReceiptOutcome> {
  if (Number.isNaN(now.getTime()))
    throw new RangeError("Recording receipt processing time is invalid");
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const retryCutoff = new Date(
        now.getTime() - RECEIPT_RETRY_DELAY_MILLISECONDS,
      );
      const receipt = await transaction
        .selectFrom("livekit_webhook_receipt")
        .selectAll()
        .where((expression) =>
          expression.or([
            expression("processingState", "=", "pending"),
            expression.and([
              expression("processingState", "=", "failed"),
              expression("processingAttempts", "<", RECEIPT_MAXIMUM_ATTEMPTS),
              expression("lastAttemptAt", "<=", retryCutoff),
            ]),
          ]),
        )
        .orderBy("receivedAt")
        .orderBy("id")
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!receipt) return { status: "no-work" };
      const attemptedAt = claimTime(receipt, now);
      await transaction
        .updateTable("livekit_webhook_receipt")
        .set({
          processingState: "processing",
          processingAttempts: receipt.processingAttempts + 1,
          lastAttemptAt: attemptedAt,
          processedAt: null,
          lastErrorCode: null,
        })
        .where("id", "=", receipt.id)
        .executeTakeFirstOrThrow();
      if (!receipt.matchedRecordingId || !receipt.matchedRoomId)
        throw new TypeError("Pending recording receipt is not matched");
      const operations = await transaction
        .selectFrom("event_virtual_room_operation")
        .select([
          "id",
          "kind",
          "requestedByUserId",
          "createdAt",
          "recordingStopDispatchedAt",
        ])
        .where("recordingId", "=", receipt.matchedRecordingId)
        .where("kind", "in", ["start_recording", "stop_recording"])
        .orderBy("id")
        .forUpdate()
        .execute();
      const recording = await transaction
        .selectFrom("event_virtual_recording")
        .selectAll()
        .where("id", "=", receipt.matchedRecordingId)
        .where("roomId", "=", receipt.matchedRoomId)
        .forUpdate()
        .executeTakeFirst();
      if (!recording)
        return finishReceipt(transaction, receipt, attemptedAt, {
          status: "failed",
          reasonCode: "recording_receipt_target_unavailable",
        });
      const conflict = receiptConflict(recording, receipt);
      if (conflict)
        return finishReceipt(transaction, receipt, attemptedAt, {
          status: "failed",
          reasonCode: conflict,
        });
      if (!receipt.normalizedStatus)
        return finishReceipt(transaction, receipt, attemptedAt, {
          status: "failed",
          reasonCode: "recording_receipt_evidence_incomplete",
        });
      const terminal = isTerminalRecording(recording.status);
      if (!terminal) {
        const stopOperation = await transaction
          .selectFrom("event_virtual_room_operation")
          .select([
            "id",
            "kind",
            "requestedByUserId",
            "createdAt",
            "recordingStopDispatchedAt",
          ])
          .where("roomId", "=", receipt.matchedRoomId)
          .where("recordingId", "=", receipt.matchedRecordingId)
          .where("kind", "=", "stop_recording")
          .executeTakeFirst();
        if (
          receipt.normalizedStatus === "complete" ||
          receipt.normalizedStatus === "failed"
        )
          await applyTerminalReceipt(
            transaction,
            recording,
            receipt,
            stopOperation,
          );
        else {
          const failureCode = await applyNonterminalReceipt(
            transaction,
            recording,
            receipt,
            stopOperation,
          );
          if (failureCode)
            return finishReceipt(transaction, receipt, attemptedAt, {
              status: "failed",
              reasonCode: failureCode,
            });
        }
      }
      const receiptIsTerminal =
        terminal ||
        receipt.normalizedStatus === "complete" ||
        receipt.normalizedStatus === "failed";
      await settleRecordingOperations(
        transaction,
        operations,
        receiptIsTerminal,
        attemptedAt,
      );
      return finishReceipt(transaction, receipt, attemptedAt, {
        status: "processed",
      });
    });
}

export async function processAvailableLiveKitRecordingReceipts(
  limit = 10,
  options: { now?: Date } = {},
): Promise<LiveKitRecordingReceiptBatch> {
  const now = options.now ?? new Date();
  const outcomes: LiveKitRecordingReceiptBatch["outcomes"] = [];
  for (let index = 0; index < limit; index += 1) {
    const outcome = await processNextLiveKitRecordingReceipt(now);
    if (outcome.status === "no-work") break;
    outcomes.push(outcome);
  }
  return { outcomes, limitReached: outcomes.length === limit };
}
