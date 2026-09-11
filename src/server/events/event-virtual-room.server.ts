import "@tanstack/react-start/server-only";

import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import {
  consumeFixedWindowRateLimit,
  type FixedWindowRateLimitEntry,
} from "#/features/event-guest/event-guest-rate-limit";
import {
  createConfiguredLiveKitProvider,
  getEnabledLiveKitConfiguration,
  LiveKitProviderError,
  type LiveKitProvider,
} from "#/server/livekit/livekit-provider.server";
import { createConfiguredLiveKitRecordingProvider } from "#/server/livekit/livekit-recording-runtime.server";
import { recordingUploadAuthorizationExpiresAt } from "#/server/livekit/livekit-recording-duration-policy.server";
import {
  LiveKitRecordingProviderError,
  type LiveKitRecordingProvider,
  type LiveKitRecordingSnapshot,
} from "#/server/livekit/livekit-recording-provider.server";
import type { EventOperationsAccess } from "./event-operations-access.server";
import { ensureEventVirtualJoinAccess } from "./event-virtual-join-access.server";
import { admitEligibleWaitingEntries } from "./event-virtual-lobby-admission.server";
import { eventVirtualPresenterIdentity } from "./event-virtual-participant-identity.server";
import { countUnconnectedVirtualCredentialReservations } from "./event-virtual-room-capacity.server";
import {
  hasVirtualRoomStaffAccess,
  lockVirtualRoomStaffAccess,
} from "./event-virtual-staff-access.server";

const PROVIDER_OPERATION_LEASE_MILLISECONDS = 2 * 60 * 1_000;
const RECORDING_START_RECONCILIATION_MILLISECONDS =
  PROVIDER_OPERATION_LEASE_MILLISECONDS;
const PROVIDER_RETRY_MAX_SECONDS = 15 * 60;
const PARTICIPANT_REVOCATION_RECHECK_MILLISECONDS = 5 * 1_000;
const TERMINAL_ROOM_RECHECK_MILLISECONDS = 5 * 1_000;
const ROOM_EMPTY_TIMEOUT_SECONDS = 10 * 60;
const ROOM_DEPARTURE_TIMEOUT_SECONDS = 20;
const TOKEN_DENIAL_AUDIT_WINDOW_MILLISECONDS = 15 * 60_000;
const TOKEN_DENIAL_AUDIT_MAXIMUM_ENTRIES = 20_000;
const presenterCredentialDenialAuditLimits = new Map<
  string,
  FixedWindowRateLimitEntry
>();

type DatabaseConnection = Kysely<Database> | Transaction<Database>;
type VirtualRoomDoorState = "scheduled" | "open" | "locked" | "ended";
type VirtualRoomAction = "start" | "lock" | "reopen" | "end" | "replace";

type EventVirtualRoomConflictReason =
  | "capacity_exceeded"
  | "invalid_transition"
  | "not_livekit"
  | "occurrence_unavailable"
  | "preparation_not_open"
  | "provider_pending"
  | "provider_unavailable"
  | "room_configuration_changed"
  | "room_not_ready"
  | "session_ended";
type VirtualRoomPreparationConflictReason =
  "occurrence_unavailable" | "preparation_not_open" | "session_ended";

export type EventVirtualRoomMutationOutcome =
  | { status: "ready" }
  | { status: "not-found" }
  | { status: "forbidden" }
  | { status: "conflict"; reason: EventVirtualRoomConflictReason };

export type EventVirtualPresenterCredentialOutcome =
  | {
      status: "ready";
      credential: {
        token: string;
        websocketUrl: string;
        generation: number;
        expiresAt: string;
      };
    }
  | Exclude<EventVirtualRoomMutationOutcome, { status: "ready" }>;

type PresenterCredentialDenialReason =
  EventVirtualRoomConflictReason | "forbidden";

async function recordPresenterCredentialDenial(
  transaction: Transaction<Database>,
  input: {
    eventOccurrenceId: string;
    eventSessionId: string;
    roomId?: string;
    roomGeneration?: number;
    actorUserId: string;
    reasonCode: PresenterCredentialDenialReason;
    phase: "preparation" | "provider" | "transaction_revalidation";
    createdAt?: Date;
  },
): Promise<void> {
  if (
    !consumeFixedWindowRateLimit(
      presenterCredentialDenialAuditLimits,
      [
        "presenter-token-denial",
        input.roomId ?? input.eventSessionId,
        input.actorUserId,
        input.reasonCode,
        input.phase,
      ].join(":"),
      Date.now(),
      {
        maximumEntries: TOKEN_DENIAL_AUDIT_MAXIMUM_ENTRIES,
        maximumRequests: 1,
        windowMs: TOKEN_DENIAL_AUDIT_WINDOW_MILLISECONDS,
      },
    )
  )
    return;
  await recordDurableAuditEvent(transaction, {
    actorUserId: input.actorUserId,
    action: "event_virtual_room.presenter_token_denied",
    subjectType: input.roomId ? "event_virtual_room" : "event_session",
    subjectId: input.roomId ?? input.eventSessionId,
    aggregateId: input.eventOccurrenceId,
    reasonCode: input.reasonCode,
    metadata: {
      responseStatus:
        input.reasonCode === "forbidden" ? "forbidden" : "conflict",
      phase: input.phase,
      eventSessionId: input.eventSessionId,
      roomGeneration: input.roomGeneration,
    },
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  });
}

async function recordStandalonePresenterCredentialDenial(
  input: Parameters<typeof recordPresenterCredentialDenial>[1],
): Promise<void> {
  await getDatabase()
    .transaction()
    .execute((transaction) =>
      recordPresenterCredentialDenial(transaction, input),
    );
}

interface EventVirtualRoomState {
  id: string;
  eventSessionId: string;
  generation: number;
  maxParticipants: number;
  doorState: VirtualRoomDoorState;
  admissionMode: "manual" | "automatic";
  providerStatus: "pending" | "ready" | "error" | "closed";
  providerErrorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  lockedAt: string | null;
  reopenedAt: string | null;
  endedAt: string | null;
}

type EventVirtualRecordingStatus =
  | "requested"
  | "starting"
  | "active"
  | "stopping"
  | "complete"
  | "failed"
  | "deleted";

interface EventVirtualRecordingOperationsState {
  status: EventVirtualRecordingStatus;
  warning: string | null;
  details?: {
    recordingId: string;
    completedAt: string;
    fileSizeBytes: string;
    durationNanoseconds: string;
    retentionDeadline: string;
    downloadAvailable: boolean;
  } | null;
}

export interface EventVirtualSessionOperations {
  eventSessionId: string;
  preparationOpensAt: string;
  canEnterGreenRoom: boolean;
  presenterRecordingNotice: string | null;
  lobbyPath: string | null;
  room: EventVirtualRoomState | null;
  recording: EventVirtualRecordingOperationsState | null;
}

const LOBBY_QUEUE_PAGE_SIZE = 50;

async function findRecordingOperationsByRoom(
  database: DatabaseConnection,
  roomIds: string[],
  observedAt = new Date(),
  includeAdministratorDetails = false,
): Promise<Map<string, EventVirtualRecordingOperationsState>> {
  if (!roomIds.length) return new Map();
  const rows = await database
    .selectFrom("event_virtual_recording as recording")
    .leftJoin("event_virtual_room_operation as operation", (join) =>
      join
        .onRef("operation.recordingId", "=", "recording.id")
        .on("operation.status", "in", ["pending", "processing"])
        .on("operation.lastErrorCode", "is not", null),
    )
    .select([
      "recording.roomId",
      "recording.id",
      "recording.status",
      "recording.completedAt",
      "recording.fileSizeBytes",
      "recording.durationNanoseconds",
      "recording.retentionDeadline",
      "operation.id as retryingOperationId",
    ])
    .select((expression) => [
      expression
        .exists(
          expression
            .selectFrom("livekit_webhook_receipt as receipt")
            .select("receipt.id")
            .whereRef("receipt.matchedRecordingId", "=", "recording.id")
            .where("receipt.processingState", "=", "failed"),
        )
        .as("hasFailedReceipt"),
      expression
        .exists(
          expression
            .selectFrom("livekit_webhook_receipt as receipt")
            .select("receipt.id")
            .whereRef("receipt.matchedRecordingId", "=", "recording.id")
            .where("receipt.processingState", "in", ["pending", "processing"])
            .where(
              "receipt.receivedAt",
              "<",
              new Date(observedAt.getTime() - 2 * 60_000),
            ),
        )
        .as("hasDelayedReceipt"),
    ])
    .where("recording.roomId", "in", roomIds)
    .execute();
  const states = new Map<string, EventVirtualRecordingOperationsState>();
  for (const row of rows) {
    const current = states.get(row.roomId);
    const retrying =
      Boolean(row.retryingOperationId) ||
      row.hasDelayedReceipt ||
      Boolean(current?.warning);
    states.set(row.roomId, {
      status: row.status,
      warning:
        row.status === "failed"
          ? "Automatic recording failed. Keep the webinar running and arrange a manual follow-up; an administrator can review the recording evidence after the session."
          : row.hasFailedReceipt
            ? "Recording evidence needs review. Background reconciliation could not apply a provider update; an administrator can review it after the session."
            : retrying
              ? "Automatic recording is delayed. Background retries are continuing; ask an administrator to check the recording service if this persists."
              : null,
      ...(includeAdministratorDetails &&
      row.completedAt &&
      row.fileSizeBytes !== null &&
      row.durationNanoseconds !== null &&
      row.retentionDeadline
        ? {
            details: {
              recordingId: row.id,
              completedAt: row.completedAt.toISOString(),
              fileSizeBytes: row.fileSizeBytes,
              durationNanoseconds: row.durationNanoseconds,
              retentionDeadline: row.retentionDeadline.toISOString(),
              downloadAvailable:
                row.status === "complete" && row.retentionDeadline > observedAt,
            },
          }
        : {}),
    });
  }
  return states;
}

export async function findEventVirtualLobbyQueue(
  eventOccurrenceId: string,
  eventSessionId: string,
  userId: string,
  page: number,
) {
  const database = getDatabase();
  if (
    !(await hasVirtualRoomStaffAccess(
      database,
      eventOccurrenceId,
      eventSessionId,
      userId,
    ))
  )
    return { status: "forbidden" } as const;
  const access = await database
    .selectFrom("event_virtual_join_access as access")
    .innerJoin("event_virtual_room as room", (join) =>
      join
        .onRef("room.eventSessionId", "=", "access.eventSessionId")
        .onRef("room.generation", "=", "access.roomGeneration"),
    )
    .select(["access.id", "room.id as roomId"])
    .where("access.eventOccurrenceId", "=", eventOccurrenceId)
    .where("access.eventSessionId", "=", eventSessionId)
    .where("access.revokedAt", "is", null)
    .executeTakeFirst();
  if (!access) return { status: "not-found" } as const;
  const recordingByRoom = await findRecordingOperationsByRoom(database, [
    access.roomId,
  ]);
  const rows = await database
    .selectFrom("event_virtual_lobby_entry as lobby")
    .innerJoin(
      "event_participation as participation",
      "participation.id",
      "lobby.eventParticipationId",
    )
    .select([
      "lobby.id",
      "lobby.eventParticipationId",
      "lobby.state",
      "lobby.accessMethod",
      "lobby.requestedAt",
      "lobby.admittedAt",
      "participation.nameSnapshot as name",
    ])
    .where("lobby.eventVirtualJoinAccessId", "=", access.id)
    .where("lobby.state", "in", [
      "waiting",
      "admitted",
      "token_issued",
      "connected",
    ])
    .orderBy(
      sql<number>`case "lobby"."state" when 'waiting' then 0 when 'connected' then 1 else 2 end`,
    )
    .orderBy("lobby.requestedAt")
    .orderBy("lobby.id")
    .limit(LOBBY_QUEUE_PAGE_SIZE + 1)
    .offset(page * LOBBY_QUEUE_PAGE_SIZE)
    .execute();
  // Read the transactionally advanced revision after the page so a mutation
  // between the two reads causes a safe client reset without scanning history.
  const revision = await database
    .selectFrom("event_virtual_join_access")
    .select("lobbyRevision")
    .where("id", "=", access.id)
    .where("revokedAt", "is", null)
    .executeTakeFirst();
  if (!revision) return { status: "not-found" } as const;
  return {
    status: "ready",
    data: {
      etag: String(revision.lobbyRevision),
      entries: rows.slice(0, LOBBY_QUEUE_PAGE_SIZE).map((entry) => ({
        id: entry.id,
        eventParticipationId: entry.eventParticipationId,
        name: entry.name,
        state: entry.state as
          "waiting" | "admitted" | "token_issued" | "connected",
        accessMethod: entry.accessMethod,
        requestedAt: entry.requestedAt.toISOString(),
        admittedAt: entry.admittedAt?.toISOString() ?? null,
      })),
      hasNextPage: rows.length > LOBBY_QUEUE_PAGE_SIZE,
      recording: recordingByRoom.get(access.roomId) ?? null,
    },
  } as const;
}

interface VirtualSessionContext {
  eventOccurrenceId: string;
  eventSessionId: string;
  occurrenceStatus:
    "draft" | "published" | "cancelled" | "completed" | "archived";
  occurrenceCapacity: number;
  startsAt: Date;
  endsAt: Date;
  admissionMode: "manual" | "automatic";
  attendanceMode: "manual" | "automatic_check_in" | "automatic_duration";
  attendanceMinimumMinutes: number | null;
  presenterPreparationMinutes: number;
  capacityHeadroom: number;
  recordingMode: "off" | "automatic";
  recordingRetentionDays: number | null;
  attendeeRecordingNotice: string;
  presenterRecordingNotice: string;
}

export interface VirtualRoomRuntime {
  provider: LiveKitProvider;
  websocketUrl: string;
  approvedMaxParticipants: number;
  recordingProvider?: LiveKitRecordingProvider | null;
}

type RoomOperationKind =
  | "ensure_room"
  | "close_room"
  | "remove_participant"
  | "start_recording"
  | "stop_recording";

interface ClaimedOperation {
  id: string;
  roomId: string;
  kind: RoomOperationKind;
  targetKey: string;
  lobbyEntryId: string | null;
  presenterUserId: string | null;
  recordingId: string | null;
  participantIdentity: string | null;
  removalEnforcedUntil: Date | null;
  recordingStartDispatchedAt: Date | null;
  recordingStopDispatchedAt: Date | null;
  recordingStopOutcomeUnknownAt: Date | null;
  attempts: number;
  requestedByUserId: string | null;
  createdAt: Date;
}

function roomState(row: {
  id: string;
  eventSessionId: string;
  generation: number;
  maxParticipants: number;
  doorState: VirtualRoomDoorState;
  admissionMode: "manual" | "automatic";
  providerStatus: "pending" | "ready" | "error" | "closed";
  providerErrorCode: string | null;
  createdAt: Date;
  startedAt: Date | null;
  lockedAt: Date | null;
  reopenedAt: Date | null;
  endedAt: Date | null;
}): EventVirtualRoomState {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    lockedAt: row.lockedAt?.toISOString() ?? null,
    reopenedAt: row.reopenedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

function resolveConfiguredRuntime(): VirtualRoomRuntime | null {
  const configuration = getEnabledLiveKitConfiguration();
  const provider = createConfiguredLiveKitProvider();
  return configuration && provider
    ? {
        provider,
        websocketUrl: configuration.url,
        approvedMaxParticipants: configuration.approvedMaxParticipants,
        recordingProvider: createConfiguredLiveKitRecordingProvider(),
      }
    : null;
}

function providerFailureCode(error: unknown): string {
  if (error instanceof RangeError) return "capacity_exceeded";
  if (error instanceof LiveKitProviderError)
    return `livekit_${error.operation}`.slice(0, 120);
  return "livekit_unavailable";
}

function retryAt(attempts: number, now: Date): Date {
  const seconds = Math.min(
    30 * 2 ** Math.max(0, attempts - 1),
    PROVIDER_RETRY_MAX_SECONDS,
  );
  return new Date(now.getTime() + seconds * 1_000);
}

function providerRoomName(): string {
  return `upskill_room_${randomUUID().replaceAll("-", "")}`;
}

function preparationOpensAt(context: VirtualSessionContext): Date {
  return new Date(
    context.startsAt.getTime() -
      context.presenterPreparationMinutes * 60 * 1_000,
  );
}

function preparationConflict(
  context: VirtualSessionContext,
  now: Date,
): VirtualRoomPreparationConflictReason | null {
  if (context.occurrenceStatus !== "published") return "occurrence_unavailable";
  if (now < preparationOpensAt(context)) return "preparation_not_open";
  if (now >= context.endsAt) return "session_ended";
  return null;
}

async function findVirtualSessionContext(
  connection: DatabaseConnection,
  eventOccurrenceId: string,
  eventSessionId: string,
): Promise<VirtualSessionContext | null | "not-livekit"> {
  const row = await connection
    .selectFrom("event_session as session")
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "session.eventOccurrenceId",
    )
    .select([
      "session.id as eventSessionId",
      "session.eventOccurrenceId",
      "session.startsAt",
      "session.endsAt",
      "session.virtualDeliveryProvider",
      "session.livekitAdmissionMode as admissionMode",
      "session.livekitAttendanceMode as attendanceMode",
      "session.livekitAttendanceMinimumMinutes as attendanceMinimumMinutes",
      "session.livekitPresenterPreparationMinutes as presenterPreparationMinutes",
      "session.livekitCapacityHeadroom as capacityHeadroom",
      "session.livekitRecordingMode as recordingMode",
      "session.livekitRecordingRetentionDays as recordingRetentionDays",
      "session.livekitAttendeeRecordingNotice as attendeeRecordingNotice",
      "session.livekitPresenterRecordingNotice as presenterRecordingNotice",
      "occurrence.status as occurrenceStatus",
      "occurrence.virtualDeliveryProvider as occurrenceProvider",
      "occurrence.capacity as occurrenceCapacity",
    ])
    .where("session.id", "=", eventSessionId)
    .where("session.eventOccurrenceId", "=", eventOccurrenceId)
    .executeTakeFirst();
  if (!row) return null;
  if (
    row.virtualDeliveryProvider !== "livekit" ||
    row.occurrenceProvider !== "livekit" ||
    !row.admissionMode ||
    !row.attendanceMode ||
    row.presenterPreparationMinutes === null ||
    row.capacityHeadroom === null ||
    !row.recordingMode
  )
    return "not-livekit";
  return {
    eventOccurrenceId: row.eventOccurrenceId,
    eventSessionId: row.eventSessionId,
    occurrenceStatus: row.occurrenceStatus,
    occurrenceCapacity: row.occurrenceCapacity,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    admissionMode: row.admissionMode,
    attendanceMode: row.attendanceMode,
    attendanceMinimumMinutes: row.attendanceMinimumMinutes,
    presenterPreparationMinutes: row.presenterPreparationMinutes,
    capacityHeadroom: row.capacityHeadroom,
    recordingMode: row.recordingMode,
    recordingRetentionDays: row.recordingRetentionDays,
    attendeeRecordingNotice: row.attendeeRecordingNotice ?? "",
    presenterRecordingNotice: row.presenterRecordingNotice ?? "",
  };
}

async function hasVirtualRoomAdministratorAccess(
  connection: DatabaseConnection,
  userId: string,
): Promise<boolean> {
  return Boolean(
    await connection
      .selectFrom("platform_admin")
      .select("userId")
      .where("userId", "=", userId)
      .executeTakeFirst(),
  );
}

async function insertRoomOperation(
  transaction: Transaction<Database>,
  roomId: string,
  kind: "ensure_room" | "close_room",
  requestedByUserId: string | null,
  now: Date,
): Promise<void> {
  await transaction
    .insertInto("event_virtual_room_operation")
    .values({
      id: `event_virtual_room_operation_${randomUUID()}`,
      roomId,
      kind,
      targetKey: "room",
      lobbyEntryId: null,
      participantIdentity: null,
      deduplicationKey: `event_virtual_room:${roomId}:${kind}`,
      status: "pending",
      availableAt: now,
      leasedUntil: null,
      lastAttemptAt: null,
      completedAt: null,
      lastErrorCode: null,
      requestedByUserId,
      createdAt: now,
    })
    .onConflict((conflict) =>
      conflict.columns(["roomId", "kind", "targetKey"]).doNothing(),
    )
    .execute();
}

function recordingNoticeDigest(notice: string): string {
  if (notice.trim().length < 2)
    throw new TypeError("Automatic recording requires a snapshotted notice.");
  return createHash("sha256").update(notice, "utf8").digest("base64url");
}

function recordingStorageObjectKey(
  eventSessionId: string,
  generation: number,
): string {
  return `recordings/${eventSessionId}/${String(generation)}/${randomUUID().replaceAll("-", "")}.mp4`;
}

type RecordingLifecycleAuditAction =
  | "event_virtual_recording.completed"
  | "event_virtual_recording.failed"
  | "event_virtual_recording.requested"
  | "event_virtual_recording.started"
  | "event_virtual_recording.stop_requested"
  | "event_virtual_recording.stop_started";

async function recordRecordingLifecycleAudit(
  transaction: Transaction<Database>,
  input: {
    action: RecordingLifecycleAuditAction;
    actorUserId: string | null;
    recordingId: string;
    roomId: string;
    eventSessionId: string;
    roomGeneration: number;
    status: string;
    previousStatus?: string;
    providerStatus?: string;
    reasonCode?: string;
    createdAt: Date;
  },
): Promise<void> {
  await recordDurableAuditEvent(transaction, {
    actorUserId: input.actorUserId,
    action: input.action,
    subjectType: "event_virtual_recording",
    subjectId: input.recordingId,
    aggregateId: input.roomId,
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    metadata: {
      roomId: input.roomId,
      eventSessionId: input.eventSessionId,
      roomGeneration: input.roomGeneration,
      status: input.status,
      previousStatus: input.previousStatus,
      providerStatus: input.providerStatus,
    },
    createdAt: input.createdAt,
  });
}

async function insertRecordingOperation(
  transaction: Transaction<Database>,
  input: {
    roomId: string;
    recordingId: string;
    kind: "start_recording" | "stop_recording";
    requestedByUserId: string;
    now: Date;
  },
): Promise<boolean> {
  const inserted = await transaction
    .insertInto("event_virtual_room_operation")
    .values({
      id: `event_virtual_room_operation_${randomUUID()}`,
      roomId: input.roomId,
      kind: input.kind,
      targetKey: input.recordingId,
      recordingId: input.recordingId,
      lobbyEntryId: null,
      presenterUserId: null,
      participantIdentity: null,
      removalEnforcedUntil: null,
      deduplicationKey: `event_virtual_room:${input.roomId}:${input.kind}:${input.recordingId}`,
      status: "pending",
      availableAt: input.now,
      leasedUntil: null,
      lastAttemptAt: null,
      completedAt: null,
      lastErrorCode: null,
      requestedByUserId: input.requestedByUserId,
      createdAt: input.now,
    })
    .onConflict((conflict) =>
      conflict.columns(["roomId", "kind", "targetKey"]).doNothing(),
    )
    .returning("id")
    .executeTakeFirst();
  return Boolean(inserted);
}

async function ensureAutomaticRecordingRequested(
  transaction: Transaction<Database>,
  input: {
    roomId: string;
    eventSessionId: string;
    roomGeneration: number;
    retentionDays: number;
    attendeeNotice: string;
    presenterNotice: string;
    requestedByUserId: string;
    now: Date;
  },
): Promise<string> {
  const existing = await transaction
    .selectFrom("event_virtual_recording")
    .select("id")
    .where("roomId", "=", input.roomId)
    .forUpdate()
    .executeTakeFirst();
  const recordingId = existing?.id ?? `event_virtual_recording_${randomUUID()}`;
  if (!existing) {
    await transaction
      .insertInto("event_virtual_recording")
      .values({
        id: recordingId,
        roomId: input.roomId,
        eventSessionId: input.eventSessionId,
        roomGeneration: input.roomGeneration,
        provider: "livekit",
        recordingMode: "automatic",
        status: "requested",
        providerEgressId: null,
        storageObjectKey: recordingStorageObjectKey(
          input.eventSessionId,
          input.roomGeneration,
        ),
        retentionDays: input.retentionDays,
        attendeeNoticeDigest: recordingNoticeDigest(input.attendeeNotice),
        presenterNoticeDigest: recordingNoticeDigest(input.presenterNotice),
        requestedByUserId: input.requestedByUserId,
        requestedAt: input.now,
        startedAt: null,
        stopRequestedByUserId: null,
        stopRequestedAt: null,
        endedAt: null,
        completedAt: null,
        fileSizeBytes: null,
        durationNanoseconds: null,
        retentionDeadline: null,
        failureCode: null,
        deletedByUserId: null,
        deletedAt: null,
        deletionReason: null,
        updatedAt: input.now,
      })
      .executeTakeFirstOrThrow();
    await recordRecordingLifecycleAudit(transaction, {
      action: "event_virtual_recording.requested",
      actorUserId: input.requestedByUserId,
      recordingId,
      roomId: input.roomId,
      eventSessionId: input.eventSessionId,
      roomGeneration: input.roomGeneration,
      status: "requested",
      createdAt: input.now,
    });
  }
  await insertRecordingOperation(transaction, {
    roomId: input.roomId,
    recordingId,
    kind: "start_recording",
    requestedByUserId: input.requestedByUserId,
    now: input.now,
  });
  return recordingId;
}

async function queueAutomaticRecordingStop(
  transaction: Transaction<Database>,
  roomId: string,
  requestedByUserId: string,
  now: Date,
): Promise<void> {
  const recording = await transaction
    .selectFrom("event_virtual_recording")
    .select(["id", "status", "eventSessionId", "roomGeneration"])
    .where("roomId", "=", roomId)
    .forUpdate()
    .executeTakeFirst();
  if (
    !recording ||
    ["complete", "failed", "deleted"].includes(recording.status)
  )
    return;
  const inserted = await insertRecordingOperation(transaction, {
    roomId,
    recordingId: recording.id,
    kind: "stop_recording",
    requestedByUserId,
    now,
  });
  if (inserted)
    await recordRecordingLifecycleAudit(transaction, {
      action: "event_virtual_recording.stop_requested",
      actorUserId: requestedByUserId,
      recordingId: recording.id,
      roomId,
      eventSessionId: recording.eventSessionId,
      roomGeneration: recording.roomGeneration,
      status: recording.status,
      createdAt: now,
    });
}

async function currentRoom(
  connection: DatabaseConnection,
  eventSessionId: string,
) {
  return connection
    .selectFrom("event_virtual_room")
    .selectAll()
    .where("eventSessionId", "=", eventSessionId)
    .where("replacedAt", "is", null)
    .executeTakeFirst();
}

async function createRoomGeneration(
  eventOccurrenceId: string,
  eventSessionId: string,
  userId: string,
  approvedMaxParticipants: number,
  clock: () => Date,
  replacesRoomId: string | null = null,
) {
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("id", "=", eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      if (!occurrence) return "occurrence-unavailable" as const;
      const session = await transaction
        .selectFrom("event_session")
        .select("id")
        .where("id", "=", eventSessionId)
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      if (!session) return "occurrence-unavailable" as const;
      const context = await findVirtualSessionContext(
        transaction,
        eventOccurrenceId,
        eventSessionId,
      );
      if (!context) return "occurrence-unavailable" as const;
      if (context === "not-livekit") return "not-livekit" as const;
      const currentNow = clock();
      const conflict = preparationConflict(context, currentNow);
      if (conflict) return conflict;
      const maxParticipants =
        context.occurrenceCapacity + context.capacityHeadroom;
      if (
        maxParticipants < 2 ||
        maxParticipants > approvedMaxParticipants ||
        maxParticipants > 10_000
      )
        return "capacity-exceeded" as const;
      const existing = await currentRoom(transaction, eventSessionId);
      if (existing)
        return existing.maxParticipants === maxParticipants
          ? existing
          : ("room-configuration-changed" as const);
      if (
        !(await hasVirtualRoomStaffAccess(
          transaction,
          eventOccurrenceId,
          eventSessionId,
          userId,
        ))
      )
        return "forbidden" as const;
      const maximum = await transaction
        .selectFrom("event_virtual_room")
        .select((expression) =>
          expression.fn.max<number>("generation").as("maximum"),
        )
        .where("eventSessionId", "=", eventSessionId)
        .executeTakeFirst();
      const generation = (maximum?.maximum ?? 0) + 1;
      const roomId = `event_virtual_room_${randomUUID()}`;
      const room = await transaction
        .insertInto("event_virtual_room")
        .values({
          id: roomId,
          eventSessionId,
          provider: "livekit",
          generation,
          providerRoomName: providerRoomName(),
          providerRoomSid: null,
          doorState: "scheduled",
          admissionMode: context.admissionMode,
          attendanceMode: context.attendanceMode,
          attendanceMinimumMinutes: context.attendanceMinimumMinutes,
          recordingMode: context.recordingMode,
          recordingRetentionDays: context.recordingRetentionDays,
          maxParticipants,
          providerStatus: "pending",
          providerErrorCode: null,
          createdByUserId: userId,
          createdAt: currentNow,
          startedByUserId: null,
          startedAt: null,
          lockedByUserId: null,
          lockedAt: null,
          reopenedByUserId: null,
          reopenedAt: null,
          endedByUserId: null,
          endedAt: null,
          replacesRoomId,
          replacedByUserId: null,
          replacedAt: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await ensureEventVirtualJoinAccess(transaction, {
        eventOccurrenceId,
        eventSessionId,
        roomGeneration: generation,
        actorUserId: userId,
        now: currentNow,
      });
      await insertRoomOperation(
        transaction,
        room.id,
        "ensure_room",
        userId,
        currentNow,
      );
      await recordDurableAuditEvent(transaction, {
        actorUserId: userId,
        action: "event_virtual_room.created",
        subjectType: "event_virtual_room",
        subjectId: room.id,
        aggregateId: eventOccurrenceId,
        metadata: {
          eventSessionId,
          generation,
          replacesRoomId,
        },
        createdAt: currentNow,
      });
      return room;
    });
}

async function claimRoomOperation(
  roomId: string,
  kind: RoomOperationKind,
  now: Date,
  targetKey = "room",
): Promise<ClaimedOperation | null> {
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const operation = await transaction
        .selectFrom("event_virtual_room_operation")
        .selectAll()
        .where("roomId", "=", roomId)
        .where("kind", "=", kind)
        .where("targetKey", "=", targetKey)
        .forUpdate()
        .executeTakeFirst();
      if (!operation) return null;
      if (
        operation.status === "processing" &&
        operation.leasedUntil &&
        operation.leasedUntil > now
      )
        return null;
      if (operation.status === "pending" && operation.availableAt > now)
        return null;
      const attempts = operation.attempts + 1;
      await transaction
        .updateTable("event_virtual_room_operation")
        .set({
          status: "processing",
          attempts,
          lastAttemptAt: now,
          leasedUntil: new Date(
            now.getTime() + PROVIDER_OPERATION_LEASE_MILLISECONDS,
          ),
          completedAt: null,
        })
        .where("id", "=", operation.id)
        .executeTakeFirstOrThrow();
      return {
        id: operation.id,
        roomId,
        kind,
        targetKey: operation.targetKey,
        lobbyEntryId: operation.lobbyEntryId,
        presenterUserId: operation.presenterUserId,
        recordingId: operation.recordingId,
        participantIdentity: operation.participantIdentity,
        removalEnforcedUntil: operation.removalEnforcedUntil,
        recordingStartDispatchedAt: operation.recordingStartDispatchedAt,
        recordingStopDispatchedAt: operation.recordingStopDispatchedAt,
        recordingStopOutcomeUnknownAt: operation.recordingStopOutcomeUnknownAt,
        attempts,
        requestedByUserId: operation.requestedByUserId,
        createdAt: operation.createdAt,
      };
    });
}

async function completeRoomOperation(
  claimed: ClaimedOperation,
  now: Date,
): Promise<void> {
  await getDatabase()
    .updateTable("event_virtual_room_operation")
    .set({
      status: "succeeded",
      leasedUntil: null,
      completedAt: now,
      lastErrorCode: null,
    })
    .where("id", "=", claimed.id)
    .where("status", "=", "processing")
    .where("attempts", "=", claimed.attempts)
    .execute();
}

async function retryRoomOperation(
  claimed: ClaimedOperation,
  code: string,
  now: Date,
  markProviderError = true,
): Promise<void> {
  await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      if (markProviderError)
        await transaction
          .selectFrom("event_virtual_room")
          .select("id")
          .where("id", "=", claimed.roomId)
          .forUpdate()
          .executeTakeFirst();
      const operation = await transaction
        .updateTable("event_virtual_room_operation")
        .set({
          status: "pending",
          leasedUntil: null,
          completedAt: null,
          lastErrorCode: code,
          availableAt: retryAt(claimed.attempts, now),
        })
        .where("id", "=", claimed.id)
        .where("status", "=", "processing")
        .where("attempts", "=", claimed.attempts)
        .executeTakeFirst();
      if (markProviderError && operation.numUpdatedRows === 1n)
        await transaction
          .updateTable("event_virtual_room")
          .set({ providerStatus: "error", providerErrorCode: code })
          .where("id", "=", claimed.roomId)
          .execute();
    });
}

async function retryAmbiguousRecordingStop(
  claimed: ClaimedOperation,
  dispatchedAt: Date,
  now: Date,
): Promise<void> {
  await getDatabase()
    .updateTable("event_virtual_room_operation")
    .set({
      status: "pending",
      leasedUntil: null,
      completedAt: null,
      lastErrorCode: "recording_stop_outcome_unknown",
      availableAt: retryAt(claimed.attempts, now),
      recordingStopOutcomeUnknownAt: dispatchedAt,
    })
    .where("id", "=", claimed.id)
    .where("status", "=", "processing")
    .where("attempts", "=", claimed.attempts)
    .execute();
}

async function requeueRoomCloseOperation(
  transaction: Transaction<Database>,
  roomId: string,
  now: Date,
  reason: string,
): Promise<void> {
  const existing = await transaction
    .selectFrom("event_virtual_room_operation")
    .select("id")
    .where("roomId", "=", roomId)
    .where("kind", "=", "close_room")
    .forUpdate()
    .executeTakeFirst();
  if (!existing) {
    await insertRoomOperation(transaction, roomId, "close_room", null, now);
    return;
  }
  await transaction
    .updateTable("event_virtual_room_operation")
    .set({
      status: "pending",
      availableAt: now,
      leasedUntil: null,
      completedAt: null,
      lastErrorCode: reason,
    })
    .where("id", "=", existing.id)
    .executeTakeFirstOrThrow();
}

async function queueCompensatingRoomClose(
  roomId: string,
  now: Date,
): Promise<void> {
  await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const room = await transaction
        .selectFrom("event_virtual_room")
        .select("id")
        .where("id", "=", roomId)
        .forUpdate()
        .executeTakeFirst();
      if (room)
        await requeueRoomCloseOperation(
          transaction,
          roomId,
          now,
          "stale_ensure_requires_close",
        );
    });
}

async function settleFailedEnsureRoom(
  claimed: ClaimedOperation,
  code: string,
  now: Date,
): Promise<"ended" | "failed" | "pending"> {
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const room = await transaction
        .selectFrom("event_virtual_room")
        .select(["doorState", "replacedAt"])
        .where("id", "=", claimed.roomId)
        .forUpdate()
        .executeTakeFirst();
      const roomOperational =
        room && !room.replacedAt && room.doorState !== "ended";
      const operation = await transaction
        .updateTable("event_virtual_room_operation")
        .set(
          roomOperational
            ? {
                status: "pending",
                leasedUntil: null,
                completedAt: null,
                lastErrorCode: code,
                availableAt: retryAt(claimed.attempts, now),
              }
            : {
                status: "succeeded",
                leasedUntil: null,
                completedAt: now,
                lastErrorCode: null,
              },
        )
        .where("id", "=", claimed.id)
        .where("status", "=", "processing")
        .where("attempts", "=", claimed.attempts)
        .executeTakeFirst();
      const currentClaim = operation.numUpdatedRows === 1n;
      if (roomOperational) {
        if (currentClaim)
          await transaction
            .updateTable("event_virtual_room")
            .set({ providerStatus: "error", providerErrorCode: code })
            .where("id", "=", claimed.roomId)
            .execute();
        return currentClaim ? "failed" : "pending";
      }
      if (room)
        await requeueRoomCloseOperation(
          transaction,
          claimed.roomId,
          now,
          "failed_ensure_requires_close",
        );
      return currentClaim ? "ended" : "pending";
    });
}

async function compensateEnsuredRoom(
  roomId: string,
  providerRoomName: string,
  runtime: VirtualRoomRuntime,
  now: Date,
): Promise<void> {
  try {
    await runtime.provider.closeRoom(providerRoomName);
  } catch {
    await queueCompensatingRoomClose(roomId, now);
  }
}

async function executeEnsureRoom(
  roomId: string,
  runtime: VirtualRoomRuntime,
  now: Date,
): Promise<"ready" | "pending" | "ended" | "failed"> {
  const claimed = await claimRoomOperation(roomId, "ensure_room", now);
  if (!claimed) return "pending";
  const room = await getDatabase()
    .selectFrom("event_virtual_room")
    .selectAll()
    .where("id", "=", roomId)
    .executeTakeFirst();
  if (!room || room.replacedAt || room.doorState === "ended") {
    await completeRoomOperation(claimed, now);
    return "ended";
  }
  try {
    const providerRoom = await runtime.provider.ensureRoom({
      roomName: room.providerRoomName,
      maxParticipants: room.maxParticipants,
      emptyTimeoutSeconds: ROOM_EMPTY_TIMEOUT_SECONDS,
      departureTimeoutSeconds: ROOM_DEPARTURE_TIMEOUT_SECONDS,
      metadata: JSON.stringify({
        application: "upskill",
        generation: room.generation,
      }),
    });
    const completion = await getDatabase()
      .transaction()
      .execute(async (transaction) => {
        const locked = await transaction
          .selectFrom("event_virtual_room")
          .select(["doorState", "replacedAt"])
          .where("id", "=", room.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const operation = await transaction
          .updateTable("event_virtual_room_operation")
          .set({
            status: "succeeded",
            leasedUntil: null,
            completedAt: now,
            lastErrorCode: null,
          })
          .where("id", "=", claimed.id)
          .where("status", "=", "processing")
          .where("attempts", "=", claimed.attempts)
          .executeTakeFirst();
        const currentClaim = operation.numUpdatedRows === 1n;
        const roomOperational =
          !locked.replacedAt && locked.doorState !== "ended";
        if (currentClaim && roomOperational)
          await transaction
            .updateTable("event_virtual_room")
            .set({
              providerRoomSid: providerRoom.sid,
              providerStatus: "ready",
              providerErrorCode: null,
            })
            .where("id", "=", room.id)
            .execute();
        return { currentClaim, roomOperational };
      });
    if (!completion.roomOperational) {
      await compensateEnsuredRoom(room.id, room.providerRoomName, runtime, now);
      return completion.currentClaim ? "ended" : "pending";
    }
    return completion.currentClaim ? "ready" : "pending";
  } catch (error) {
    return settleFailedEnsureRoom(claimed, providerFailureCode(error), now);
  }
}

export async function findEventVirtualSessionOperations(
  eventOccurrenceId: string,
  access: EventOperationsAccess,
  now = new Date(),
): Promise<EventVirtualSessionOperations[]> {
  const database = getDatabase();
  const presenterSessionIds = new Set(access.presenterSessionIds);
  const sessions = await database
    .selectFrom("event_session as session")
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "session.eventOccurrenceId",
    )
    .select([
      "session.id",
      "session.startsAt",
      "session.endsAt",
      "session.livekitPresenterPreparationMinutes",
      "session.livekitRecordingMode",
      "session.livekitPresenterRecordingNotice",
      "occurrence.status as occurrenceStatus",
    ])
    .where("session.eventOccurrenceId", "=", eventOccurrenceId)
    .where("session.virtualDeliveryProvider", "=", "livekit")
    .orderBy("session.position")
    .execute();
  const authorised = sessions.filter(
    (session) =>
      access.isPlatformAdministrator ||
      access.isAssignedAdministrator ||
      access.presentsWholeOccurrence ||
      presenterSessionIds.has(session.id),
  );
  if (!authorised.length) return [];
  const rooms = await database
    .selectFrom("event_virtual_room")
    .select([
      "id",
      "eventSessionId",
      "generation",
      "maxParticipants",
      "doorState",
      "admissionMode",
      "providerStatus",
      "providerErrorCode",
      "createdAt",
      "startedAt",
      "lockedAt",
      "reopenedAt",
      "endedAt",
    ])
    .where(
      "eventSessionId",
      "in",
      authorised.map((session) => session.id),
    )
    .where("replacedAt", "is", null)
    .execute();
  const roomBySession = new Map(
    rooms.map((room) => [room.eventSessionId, room]),
  );
  const recordingByRoom = await findRecordingOperationsByRoom(
    database,
    rooms.map((room) => room.id),
    now,
    access.isPlatformAdministrator || access.isAssignedAdministrator,
  );
  const joinAccess = await database
    .selectFrom("event_virtual_join_access")
    .select(["id", "eventSessionId", "publicReference"])
    .where(
      "eventSessionId",
      "in",
      authorised.map((session) => session.id),
    )
    .where("revokedAt", "is", null)
    .execute();
  const accessBySession = new Map(
    joinAccess.map((item) => [item.eventSessionId, item]),
  );
  return authorised.map((session) => {
    const opensAt = new Date(
      session.startsAt.getTime() -
        (session.livekitPresenterPreparationMinutes ?? 0) * 60 * 1_000,
    );
    const room = roomBySession.get(session.id);
    const accessRecord = accessBySession.get(session.id);
    return {
      eventSessionId: session.id,
      preparationOpensAt: opensAt.toISOString(),
      canEnterGreenRoom:
        session.occurrenceStatus === "published" &&
        now >= opensAt &&
        now < session.endsAt &&
        room?.doorState !== "ended",
      presenterRecordingNotice:
        session.livekitRecordingMode === "automatic"
          ? session.livekitPresenterRecordingNotice
          : null,
      lobbyPath: accessRecord
        ? `/webinars/${accessRecord.publicReference}`
        : null,
      room: room ? roomState(room) : null,
      recording: room ? (recordingByRoom.get(room.id) ?? null) : null,
    };
  });
}

export async function ensureEventVirtualRoomForStaff(
  eventOccurrenceId: string,
  eventSessionId: string,
  user: AuthenticatedUser,
  options: { runtime?: VirtualRoomRuntime; clock?: () => Date } = {},
): Promise<EventVirtualRoomMutationOutcome> {
  const clock = options.clock ?? (() => new Date());
  const now = clock();
  const database = getDatabase();
  const context = await findVirtualSessionContext(
    database,
    eventOccurrenceId,
    eventSessionId,
  );
  if (!context) return { status: "not-found" };
  if (context === "not-livekit")
    return { status: "conflict", reason: "not_livekit" };
  const staff = await hasVirtualRoomStaffAccess(
    database,
    eventOccurrenceId,
    eventSessionId,
    user.id,
  );
  if (!staff) return { status: "forbidden" };
  const conflict = preparationConflict(context, now);
  if (conflict) return { status: "conflict", reason: conflict };
  let runtime: VirtualRoomRuntime | null;
  try {
    runtime = options.runtime ?? resolveConfiguredRuntime();
  } catch {
    runtime = null;
  }
  if (!runtime) return { status: "conflict", reason: "provider_unavailable" };
  const maxParticipants = context.occurrenceCapacity + context.capacityHeadroom;
  if (
    maxParticipants < 2 ||
    maxParticipants > runtime.approvedMaxParticipants ||
    maxParticipants > 10_000
  )
    return { status: "conflict", reason: "capacity_exceeded" };
  let room = await currentRoom(database, eventSessionId);
  if (!room) {
    const created = await createRoomGeneration(
      eventOccurrenceId,
      eventSessionId,
      user.id,
      runtime.approvedMaxParticipants,
      clock,
    );
    if (created === "forbidden") return { status: "forbidden" };
    if (created === "occurrence-unavailable")
      return { status: "conflict", reason: "occurrence_unavailable" };
    if (created === "occurrence_unavailable")
      return { status: "conflict", reason: created };
    if (created === "not-livekit")
      return { status: "conflict", reason: "not_livekit" };
    if (created === "capacity-exceeded")
      return { status: "conflict", reason: "capacity_exceeded" };
    if (created === "room-configuration-changed")
      return { status: "conflict", reason: "room_configuration_changed" };
    if (created === "preparation_not_open" || created === "session_ended")
      return { status: "conflict", reason: created };
    room = created;
  }
  if (room.maxParticipants !== maxParticipants)
    return { status: "conflict", reason: "room_configuration_changed" };
  if (room.doorState === "ended")
    return { status: "conflict", reason: "session_ended" };
  const readiness = await executeEnsureRoom(room.id, runtime, clock());
  if (readiness === "pending")
    return { status: "conflict", reason: "provider_pending" };
  if (readiness !== "ready")
    return { status: "conflict", reason: "provider_unavailable" };
  return database.transaction().execute(async (transaction) => {
    const occurrence = await transaction
      .selectFrom("event_occurrence")
      .select("id")
      .where("id", "=", eventOccurrenceId)
      .forUpdate()
      .executeTakeFirst();
    if (!occurrence) return { status: "not-found" } as const;
    const session = await transaction
      .selectFrom("event_session")
      .select("id")
      .where("id", "=", eventSessionId)
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .forUpdate()
      .executeTakeFirst();
    if (!session) return { status: "not-found" } as const;
    const currentContext = await findVirtualSessionContext(
      transaction,
      eventOccurrenceId,
      eventSessionId,
    );
    if (!currentContext) return { status: "not-found" } as const;
    if (currentContext === "not-livekit")
      return { status: "conflict", reason: "not_livekit" } as const;
    const currentRoom = await transaction
      .selectFrom("event_virtual_room")
      .select(["id", "maxParticipants"])
      .where("id", "=", room.id)
      .where("eventSessionId", "=", eventSessionId)
      .where("replacedAt", "is", null)
      .where("doorState", "!=", "ended")
      .where("providerStatus", "=", "ready")
      .forUpdate()
      .executeTakeFirst();
    if (!currentRoom)
      return { status: "conflict", reason: "room_not_ready" } as const;
    const currentMaxParticipants =
      currentContext.occurrenceCapacity + currentContext.capacityHeadroom;
    if (
      currentMaxParticipants < 2 ||
      currentMaxParticipants > runtime.approvedMaxParticipants ||
      currentMaxParticipants > 10_000
    )
      return { status: "conflict", reason: "capacity_exceeded" } as const;
    if (currentRoom.maxParticipants !== currentMaxParticipants)
      return {
        status: "conflict",
        reason: "room_configuration_changed",
      } as const;
    if (
      !(await hasVirtualRoomStaffAccess(
        transaction,
        eventOccurrenceId,
        eventSessionId,
        user.id,
      ))
    )
      return { status: "forbidden" } as const;
    const currentConflict = preparationConflict(currentContext, clock());
    return currentConflict
      ? ({ status: "conflict", reason: currentConflict } as const)
      : ({ status: "ready" } as const);
  });
}

export async function issueEventVirtualPresenterCredential(
  eventOccurrenceId: string,
  eventSessionId: string,
  user: AuthenticatedUser,
  options: { runtime?: VirtualRoomRuntime; clock?: () => Date } = {},
): Promise<EventVirtualPresenterCredentialOutcome> {
  const clock = options.clock ?? (() => new Date());
  const database = getDatabase();
  let runtime: VirtualRoomRuntime | null;
  try {
    runtime = options.runtime ?? resolveConfiguredRuntime();
  } catch {
    runtime = null;
  }
  if (!runtime) {
    const context = await findVirtualSessionContext(
      database,
      eventOccurrenceId,
      eventSessionId,
    );
    if (
      context &&
      context !== "not-livekit" &&
      (await hasVirtualRoomStaffAccess(
        database,
        eventOccurrenceId,
        eventSessionId,
        user.id,
      ))
    )
      await recordStandalonePresenterCredentialDenial({
        eventOccurrenceId,
        eventSessionId,
        actorUserId: user.id,
        reasonCode: "provider_unavailable",
        phase: "provider",
        createdAt: clock(),
      });
    return { status: "conflict", reason: "provider_unavailable" };
  }
  const preparation = await ensureEventVirtualRoomForStaff(
    eventOccurrenceId,
    eventSessionId,
    user,
    { runtime, clock },
  );
  if (preparation.status !== "ready") {
    if (preparation.status === "conflict" || preparation.status === "forbidden")
      await recordStandalonePresenterCredentialDenial({
        eventOccurrenceId,
        eventSessionId,
        actorUserId: user.id,
        reasonCode:
          preparation.status === "forbidden" ? "forbidden" : preparation.reason,
        phase: "preparation",
        createdAt: clock(),
      });
    return preparation;
  }

  const room = await database
    .selectFrom("event_virtual_room")
    .select(["id", "generation", "providerRoomName", "providerStatus"])
    .where("eventSessionId", "=", eventSessionId)
    .where("replacedAt", "is", null)
    .where("doorState", "!=", "ended")
    .executeTakeFirst();
  if (!room || room.providerStatus !== "ready") {
    await recordStandalonePresenterCredentialDenial({
      eventOccurrenceId,
      eventSessionId,
      ...(room ? { roomId: room.id, roomGeneration: room.generation } : {}),
      actorUserId: user.id,
      reasonCode: "room_not_ready",
      phase: "preparation",
      createdAt: clock(),
    });
    return { status: "conflict", reason: "room_not_ready" };
  }
  if (
    !(await hasVirtualRoomStaffAccess(
      database,
      eventOccurrenceId,
      eventSessionId,
      user.id,
    ))
  ) {
    await recordStandalonePresenterCredentialDenial({
      eventOccurrenceId,
      eventSessionId,
      roomId: room.id,
      roomGeneration: room.generation,
      actorUserId: user.id,
      reasonCode: "forbidden",
      phase: "transaction_revalidation",
      createdAt: clock(),
    });
    return { status: "forbidden" };
  }

  try {
    const providerCredential = await runtime.provider.createJoinToken({
      roomName: room.providerRoomName,
      participantIdentity: eventVirtualPresenterIdentity(room.id, user.id),
      displayName: user.name.trim().slice(0, 200) || "Presenter",
      role: "presenter",
    });
    const credentialStillAuthorised = await database
      .transaction()
      .execute(async (transaction) => {
        const deny = async (
          reasonCode: PresenterCredentialDenialReason,
          createdAt = clock(),
        ) =>
          recordPresenterCredentialDenial(transaction, {
            eventOccurrenceId,
            eventSessionId,
            roomId: room.id,
            roomGeneration: room.generation,
            actorUserId: user.id,
            reasonCode,
            phase: "transaction_revalidation",
            createdAt,
          });
        const occurrence = await transaction
          .selectFrom("event_occurrence")
          .select("id")
          .where("id", "=", eventOccurrenceId)
          .forUpdate()
          .executeTakeFirst();
        if (!occurrence) {
          await deny("occurrence_unavailable");
          return "occurrence_unavailable" as const;
        }
        const currentContext = await findVirtualSessionContext(
          transaction,
          eventOccurrenceId,
          eventSessionId,
        );
        if (!currentContext || currentContext === "not-livekit") {
          await deny("occurrence_unavailable");
          return "occurrence_unavailable" as const;
        }
        const currentRoom = await transaction
          .selectFrom("event_virtual_room")
          .select(["id", "maxParticipants"])
          .where("id", "=", room.id)
          .where("eventSessionId", "=", eventSessionId)
          .where("replacedAt", "is", null)
          .where("doorState", "!=", "ended")
          .where("providerStatus", "=", "ready")
          .forUpdate()
          .executeTakeFirst();
        if (!currentRoom) {
          await deny("room_not_ready");
          return "room-not-ready" as const;
        }
        if (
          !(await lockVirtualRoomStaffAccess(
            transaction,
            eventOccurrenceId,
            eventSessionId,
            user.id,
          ))
        ) {
          await deny("forbidden");
          return "forbidden" as const;
        }
        const currentNow = clock();
        const currentConflict = preparationConflict(currentContext, currentNow);
        if (currentConflict) {
          await deny(currentConflict, currentNow);
          return currentConflict;
        }
        if (providerCredential.expiresAt <= currentNow) {
          await deny("provider_unavailable", currentNow);
          return "provider_unavailable" as const;
        }
        try {
          const participantIdentity = eventVirtualPresenterIdentity(
            room.id,
            user.id,
          );
          const participants = await runtime.provider.listParticipants(
            room.providerRoomName,
          );
          const connectedIdentities = new Set(
            participants.map((participant) => participant.identity),
          );
          if (!connectedIdentities.has(participantIdentity)) {
            const unconnectedReservations =
              await countUnconnectedVirtualCredentialReservations(transaction, {
                roomId: room.id,
                eventSessionId,
                roomGeneration: room.generation,
                connectedIdentities,
                now: currentNow,
                excludingPresenterUserId: user.id,
              });
            if (
              participants.length + unconnectedReservations.total >=
              currentRoom.maxParticipants
            ) {
              await deny("capacity_exceeded", currentNow);
              return "capacity_exceeded" as const;
            }
          }
        } catch (error) {
          if (!(error instanceof LiveKitProviderError)) throw error;
          await deny("provider_unavailable", currentNow);
          return "provider_unavailable" as const;
        }
        const issuedAt = clock();
        if (providerCredential.expiresAt <= issuedAt) {
          await deny("provider_unavailable", issuedAt);
          return "provider_unavailable" as const;
        }
        await transaction
          .insertInto("event_virtual_presenter_credential_reservation")
          .values({
            roomId: room.id,
            userId: user.id,
            credentialExpiresAt: providerCredential.expiresAt,
            firstTokenIssuedAt: issuedAt,
            lastTokenIssuedAt: issuedAt,
          })
          .onConflict((conflict) =>
            conflict.columns(["roomId", "userId"]).doUpdateSet({
              credentialExpiresAt: sql<Date>`greatest(
                event_virtual_presenter_credential_reservation."credentialExpiresAt",
                excluded."credentialExpiresAt"
              )`,
              lastTokenIssuedAt: sql<Date>`greatest(
                event_virtual_presenter_credential_reservation."lastTokenIssuedAt",
                excluded."lastTokenIssuedAt"
              )`,
            }),
          )
          .execute();
        await recordDurableAuditEvent(transaction, {
          actorUserId: user.id,
          action: "event_virtual_room.presenter_token_issued",
          subjectType: "event_virtual_room",
          subjectId: room.id,
          aggregateId: eventOccurrenceId,
          metadata: { eventSessionId, generation: room.generation },
          createdAt: issuedAt,
        });
        return "ready" as const;
      });
    if (credentialStillAuthorised === "room-not-ready")
      return { status: "conflict", reason: "room_not_ready" };
    if (credentialStillAuthorised === "forbidden")
      return { status: "forbidden" };
    if (credentialStillAuthorised !== "ready")
      return { status: "conflict", reason: credentialStillAuthorised };
    return {
      status: "ready",
      credential: {
        token: providerCredential.token,
        websocketUrl: runtime.websocketUrl,
        generation: room.generation,
        expiresAt: providerCredential.expiresAt.toISOString(),
      },
    };
  } catch {
    await recordStandalonePresenterCredentialDenial({
      eventOccurrenceId,
      eventSessionId,
      roomId: room.id,
      roomGeneration: room.generation,
      actorUserId: user.id,
      reasonCode: "provider_unavailable",
      phase: "provider",
      createdAt: clock(),
    });
    return { status: "conflict", reason: "provider_unavailable" };
  }
}

export async function endEventVirtualRoomsForOccurrence(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
  actorUserId: string,
  now: Date,
): Promise<void> {
  const rooms = await transaction
    .selectFrom("event_virtual_room as room")
    .innerJoin("event_session as session", "session.id", "room.eventSessionId")
    .select([
      "room.id",
      "room.eventSessionId",
      "room.generation",
      "room.doorState",
    ])
    .where("session.eventOccurrenceId", "=", eventOccurrenceId)
    .where("room.replacedAt", "is", null)
    .forUpdate("room")
    .execute();
  for (const room of rooms) {
    if (room.doorState !== "ended") {
      await transaction
        .updateTable("event_virtual_room")
        .set({
          doorState: "ended",
          endedByUserId: actorUserId,
          endedAt: now,
        })
        .where("id", "=", room.id)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId,
        action: "event_virtual_room.lifecycle_changed",
        subjectType: "event_virtual_room",
        subjectId: room.id,
        aggregateId: eventOccurrenceId,
        metadata: {
          eventSessionId: room.eventSessionId,
          generation: room.generation,
          transition: "occurrence_terminal",
          previousState: room.doorState,
        },
        createdAt: now,
      });
    }
    await queueAutomaticRecordingStop(transaction, room.id, actorUserId, now);
    await insertRoomOperation(
      transaction,
      room.id,
      "close_room",
      actorUserId,
      now,
    );
  }
}

function transitionValues(
  action: Exclude<VirtualRoomAction, "replace">,
  userId: string,
  now: Date,
) {
  switch (action) {
    case "start":
      return {
        doorState: "open" as const,
        startedByUserId: userId,
        startedAt: now,
      };
    case "lock":
      return {
        doorState: "locked" as const,
        lockedByUserId: userId,
        lockedAt: now,
      };
    case "reopen":
      return {
        doorState: "open" as const,
        reopenedByUserId: userId,
        reopenedAt: now,
      };
    case "end":
      return {
        doorState: "ended" as const,
        endedByUserId: userId,
        endedAt: now,
      };
  }
}

export async function transitionEventVirtualRoom(
  eventOccurrenceId: string,
  eventSessionId: string,
  action: Exclude<VirtualRoomAction, "replace">,
  user: AuthenticatedUser,
  options: { runtime?: VirtualRoomRuntime; clock?: () => Date } = {},
): Promise<EventVirtualRoomMutationOutcome> {
  const clock = options.clock ?? (() => new Date());
  const database = getDatabase();
  if (action === "start") {
    const idempotentStart = await database
      .transaction()
      .execute(async (transaction) => {
        const occurrence = await transaction
          .selectFrom("event_occurrence")
          .select("id")
          .where("id", "=", eventOccurrenceId)
          .forUpdate()
          .executeTakeFirst();
        if (!occurrence) return { status: "not-found" } as const;
        const session = await transaction
          .selectFrom("event_session")
          .select("id")
          .where("id", "=", eventSessionId)
          .where("eventOccurrenceId", "=", eventOccurrenceId)
          .forUpdate()
          .executeTakeFirst();
        if (!session) return { status: "not-found" } as const;
        const context = await findVirtualSessionContext(
          transaction,
          eventOccurrenceId,
          eventSessionId,
        );
        if (!context) return { status: "not-found" } as const;
        if (context === "not-livekit")
          return { status: "conflict", reason: "not_livekit" } as const;
        if (
          !(await hasVirtualRoomStaffAccess(
            transaction,
            eventOccurrenceId,
            eventSessionId,
            user.id,
          ))
        )
          return { status: "forbidden" } as const;
        if (context.occurrenceStatus !== "published")
          return {
            status: "conflict",
            reason: "occurrence_unavailable",
          } as const;
        const room = await transaction
          .selectFrom("event_virtual_room")
          .selectAll()
          .where("eventSessionId", "=", eventSessionId)
          .where("replacedAt", "is", null)
          .forUpdate()
          .executeTakeFirst();
        if (room?.doorState !== "open") return null;
        if (
          room.recordingMode === "automatic" &&
          room.recordingRetentionDays !== null
        )
          await ensureAutomaticRecordingRequested(transaction, {
            roomId: room.id,
            eventSessionId,
            roomGeneration: room.generation,
            retentionDays: room.recordingRetentionDays,
            attendeeNotice: context.attendeeRecordingNotice,
            presenterNotice: context.presenterRecordingNotice,
            requestedByUserId: room.startedByUserId ?? user.id,
            now: room.startedAt ?? clock(),
          });
        return { status: "ready" } as const;
      });
    if (idempotentStart) return idempotentStart;
    let runtime: VirtualRoomRuntime | null;
    try {
      runtime = options.runtime ?? resolveConfiguredRuntime();
    } catch {
      runtime = null;
    }
    if (!runtime) return { status: "conflict", reason: "provider_unavailable" };
    const preparation = await ensureEventVirtualRoomForStaff(
      eventOccurrenceId,
      eventSessionId,
      user,
      { runtime, clock },
    );
    if (preparation.status !== "ready") return preparation;
  }
  return database.transaction().execute(async (transaction) => {
    const occurrence = await transaction
      .selectFrom("event_occurrence")
      .select("id")
      .where("id", "=", eventOccurrenceId)
      .forUpdate()
      .executeTakeFirst();
    if (!occurrence) return { status: "not-found" } as const;
    const session = await transaction
      .selectFrom("event_session")
      .select("id")
      .where("id", "=", eventSessionId)
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .forUpdate()
      .executeTakeFirst();
    if (!session) return { status: "not-found" } as const;
    const context = await findVirtualSessionContext(
      transaction,
      eventOccurrenceId,
      eventSessionId,
    );
    if (!context) return { status: "not-found" } as const;
    if (context === "not-livekit")
      return { status: "conflict", reason: "not_livekit" } as const;
    if (
      !(await hasVirtualRoomStaffAccess(
        transaction,
        eventOccurrenceId,
        eventSessionId,
        user.id,
      ))
    )
      return { status: "forbidden" } as const;
    if (context.occurrenceStatus !== "published")
      return { status: "conflict", reason: "occurrence_unavailable" } as const;
    const room = await transaction
      .selectFrom("event_virtual_room")
      .selectAll()
      .where("eventSessionId", "=", eventSessionId)
      .where("replacedAt", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (!room) return { status: "conflict", reason: "room_not_ready" } as const;
    if (
      !(await hasVirtualRoomStaffAccess(
        transaction,
        eventOccurrenceId,
        eventSessionId,
        user.id,
      ))
    )
      return { status: "forbidden" } as const;
    const currentNow = clock();
    if (action === "start") {
      const conflict = preparationConflict(context, currentNow);
      if (conflict) return { status: "conflict", reason: conflict } as const;
    }
    const allowed =
      (action === "start" && room.doorState === "scheduled") ||
      (action === "lock" && room.doorState === "open") ||
      (action === "reopen" && room.doorState === "locked") ||
      (action === "end" && room.doorState !== "ended");
    if (!allowed) {
      const idempotent =
        (action === "start" && room.doorState === "open") ||
        (action === "lock" && room.doorState === "locked") ||
        (action === "reopen" &&
          room.doorState === "open" &&
          room.reopenedAt !== null) ||
        (action === "end" && room.doorState === "ended");
      return idempotent
        ? ({ status: "ready" } as const)
        : ({ status: "conflict", reason: "invalid_transition" } as const);
    }
    if (action === "start") {
      if (room.providerStatus !== "ready")
        return { status: "conflict", reason: "room_not_ready" } as const;
    }
    await transaction
      .updateTable("event_virtual_room")
      .set(transitionValues(action, user.id, currentNow))
      .where("id", "=", room.id)
      .executeTakeFirstOrThrow();
    if (
      action === "start" &&
      room.recordingMode === "automatic" &&
      room.recordingRetentionDays !== null
    )
      await ensureAutomaticRecordingRequested(transaction, {
        roomId: room.id,
        eventSessionId,
        roomGeneration: room.generation,
        retentionDays: room.recordingRetentionDays,
        attendeeNotice: context.attendeeRecordingNotice,
        presenterNotice: context.presenterRecordingNotice,
        requestedByUserId: user.id,
        now: currentNow,
      });
    if (action === "end")
      await queueAutomaticRecordingStop(
        transaction,
        room.id,
        user.id,
        currentNow,
      );
    if (action === "end")
      await insertRoomOperation(
        transaction,
        room.id,
        "close_room",
        user.id,
        currentNow,
      );
    await recordDurableAuditEvent(transaction, {
      actorUserId: user.id,
      action: "event_virtual_room.lifecycle_changed",
      subjectType: "event_virtual_room",
      subjectId: room.id,
      aggregateId: eventOccurrenceId,
      metadata: {
        eventSessionId,
        generation: room.generation,
        transition: action,
        previousState: room.doorState,
      },
      createdAt: currentNow,
    });
    return { status: "ready" } as const;
  });
}

export async function setEventVirtualRoomAdmissionMode(
  eventOccurrenceId: string,
  eventSessionId: string,
  admissionMode: "manual" | "automatic",
  user: AuthenticatedUser,
  options: { clock?: () => Date } = {},
): Promise<EventVirtualRoomMutationOutcome> {
  const clock = options.clock ?? (() => new Date());
  const database = getDatabase();
  const context = await findVirtualSessionContext(
    database,
    eventOccurrenceId,
    eventSessionId,
  );
  if (!context) return { status: "not-found" };
  if (context === "not-livekit")
    return { status: "conflict", reason: "not_livekit" };
  if (
    !(await hasVirtualRoomStaffAccess(
      database,
      eventOccurrenceId,
      eventSessionId,
      user.id,
    ))
  )
    return { status: "forbidden" };
  if (context.occurrenceStatus !== "published")
    return { status: "conflict", reason: "occurrence_unavailable" };
  const outcome = await database.transaction().execute(async (transaction) => {
    const occurrence = await transaction
      .selectFrom("event_occurrence")
      .select("id")
      .where("id", "=", eventOccurrenceId)
      .forUpdate()
      .executeTakeFirst();
    if (!occurrence) return { status: "not-found" } as const;
    const session = await transaction
      .selectFrom("event_session")
      .select("id")
      .where("id", "=", eventSessionId)
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .forUpdate()
      .executeTakeFirst();
    if (!session) return { status: "not-found" } as const;
    const currentContext = await findVirtualSessionContext(
      transaction,
      eventOccurrenceId,
      eventSessionId,
    );
    if (!currentContext) return { status: "not-found" } as const;
    if (currentContext === "not-livekit")
      return { status: "conflict", reason: "not_livekit" } as const;
    if (currentContext.occurrenceStatus !== "published")
      return {
        status: "conflict",
        reason: "occurrence_unavailable",
      } as const;
    const room = await transaction
      .selectFrom("event_virtual_room")
      .selectAll()
      .where("eventSessionId", "=", eventSessionId)
      .where("replacedAt", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (!room) return { status: "conflict", reason: "room_not_ready" } as const;
    if (
      !(await hasVirtualRoomStaffAccess(
        transaction,
        eventOccurrenceId,
        eventSessionId,
        user.id,
      ))
    )
      return { status: "forbidden" } as const;
    const currentNow = clock();
    if (room.doorState === "scheduled" && currentNow >= currentContext.endsAt)
      return { status: "conflict", reason: "session_ended" } as const;
    if (room.doorState === "ended")
      return { status: "conflict", reason: "invalid_transition" } as const;
    if (room.admissionMode === admissionMode)
      return admissionMode === "automatic"
        ? ({
            status: "ready-auto-admission",
            roomGeneration: room.generation,
          } as const)
        : ({ status: "ready" } as const);
    await transaction
      .updateTable("event_virtual_room")
      .set({ admissionMode })
      .where("id", "=", room.id)
      .execute();
    await recordDurableAuditEvent(transaction, {
      actorUserId: user.id,
      action: "event_virtual_room.lifecycle_changed",
      subjectType: "event_virtual_room",
      subjectId: room.id,
      aggregateId: eventOccurrenceId,
      metadata: {
        eventSessionId,
        generation: room.generation,
        transition: "admission_mode_changed",
        previousAdmissionMode: room.admissionMode,
        admissionMode,
      },
      createdAt: currentNow,
    });
    return admissionMode === "automatic"
      ? ({
          status: "ready-auto-admission",
          roomGeneration: room.generation,
        } as const)
      : ({ status: "ready" } as const);
  });
  if (outcome.status !== "ready-auto-admission") return outcome;
  await admitEligibleWaitingEntries(
    database,
    {
      eventOccurrenceId,
      eventSessionId,
      roomGeneration: outcome.roomGeneration,
      actorUserId: user.id,
      source: "automatic_mode_enabled",
    },
    { clock },
  );
  return { status: "ready" };
}

export async function replaceEventVirtualRoom(
  eventOccurrenceId: string,
  eventSessionId: string,
  user: AuthenticatedUser,
  options: { clock?: () => Date } = {},
): Promise<EventVirtualRoomMutationOutcome> {
  const clock = options.clock ?? (() => new Date());
  const database = getDatabase();
  const context = await findVirtualSessionContext(
    database,
    eventOccurrenceId,
    eventSessionId,
  );
  if (!context) return { status: "not-found" };
  if (context === "not-livekit")
    return { status: "conflict", reason: "not_livekit" };
  if (
    !(await hasVirtualRoomStaffAccess(
      database,
      eventOccurrenceId,
      eventSessionId,
      user.id,
    ))
  )
    return { status: "forbidden" };
  if (context.occurrenceStatus !== "published")
    return { status: "conflict", reason: "occurrence_unavailable" };

  return database.transaction().execute(async (transaction) => {
    const occurrence = await transaction
      .selectFrom("event_occurrence")
      .select("id")
      .where("id", "=", eventOccurrenceId)
      .forUpdate()
      .executeTakeFirst();
    if (!occurrence)
      return { status: "conflict", reason: "occurrence_unavailable" } as const;
    const session = await transaction
      .selectFrom("event_session")
      .select("id")
      .where("id", "=", eventSessionId)
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .forUpdate()
      .executeTakeFirst();
    if (!session)
      return { status: "conflict", reason: "occurrence_unavailable" } as const;
    const currentContext = await findVirtualSessionContext(
      transaction,
      eventOccurrenceId,
      eventSessionId,
    );
    if (!currentContext || currentContext === "not-livekit")
      return { status: "conflict", reason: "occurrence_unavailable" } as const;
    if (currentContext.occurrenceStatus !== "published")
      return { status: "conflict", reason: "occurrence_unavailable" } as const;
    const room = await transaction
      .selectFrom("event_virtual_room")
      .selectAll()
      .where("eventSessionId", "=", eventSessionId)
      .where("replacedAt", "is", null)
      .forUpdate()
      .executeTakeFirst();
    if (!room) return { status: "conflict", reason: "room_not_ready" } as const;
    if (
      !(await hasVirtualRoomStaffAccess(
        transaction,
        eventOccurrenceId,
        eventSessionId,
        user.id,
      ))
    )
      return { status: "forbidden" } as const;
    const currentNow = clock();
    const conflict = preparationConflict(currentContext, currentNow);
    if (conflict) return { status: "conflict", reason: conflict } as const;
    if (room.doorState === "ended") {
      if (!(await hasVirtualRoomAdministratorAccess(transaction, user.id)))
        return { status: "forbidden" } as const;
    } else if (room.providerStatus !== "error") {
      return { status: "conflict", reason: "invalid_transition" } as const;
    }

    await transaction
      .updateTable("event_virtual_room")
      .set({
        doorState: "ended",
        endedByUserId: room.endedByUserId ?? user.id,
        endedAt: room.endedAt ?? currentNow,
        replacedByUserId: user.id,
        replacedAt: currentNow,
      })
      .where("id", "=", room.id)
      .executeTakeFirstOrThrow();
    await queueAutomaticRecordingStop(
      transaction,
      room.id,
      user.id,
      currentNow,
    );
    await insertRoomOperation(
      transaction,
      room.id,
      "close_room",
      user.id,
      currentNow,
    );

    const replacementId = `event_virtual_room_${randomUUID()}`;
    const replacement = await transaction
      .insertInto("event_virtual_room")
      .values({
        id: replacementId,
        eventSessionId,
        provider: "livekit",
        generation: room.generation + 1,
        providerRoomName: providerRoomName(),
        providerRoomSid: null,
        doorState: "scheduled",
        admissionMode: room.admissionMode,
        attendanceMode: room.attendanceMode,
        attendanceMinimumMinutes: room.attendanceMinimumMinutes,
        recordingMode: room.recordingMode,
        recordingRetentionDays: room.recordingRetentionDays,
        maxParticipants: room.maxParticipants,
        providerStatus: "pending",
        providerErrorCode: null,
        createdByUserId: user.id,
        createdAt: currentNow,
        startedByUserId: null,
        startedAt: null,
        lockedByUserId: null,
        lockedAt: null,
        reopenedByUserId: null,
        reopenedAt: null,
        endedByUserId: null,
        endedAt: null,
        replacesRoomId: room.id,
        replacedByUserId: null,
        replacedAt: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ensureEventVirtualJoinAccess(transaction, {
      eventOccurrenceId,
      eventSessionId,
      roomGeneration: replacement.generation,
      actorUserId: user.id,
      now: currentNow,
    });
    await insertRoomOperation(
      transaction,
      replacement.id,
      "ensure_room",
      user.id,
      currentNow,
    );
    await recordDurableAuditEvent(transaction, {
      actorUserId: user.id,
      action: "event_virtual_room.lifecycle_changed",
      subjectType: "event_virtual_room",
      subjectId: room.id,
      aggregateId: eventOccurrenceId,
      metadata: {
        eventSessionId,
        generation: room.generation,
        transition: "replaced",
        replacementRoomId: replacement.id,
      },
      createdAt: currentNow,
    });
    await recordDurableAuditEvent(transaction, {
      actorUserId: user.id,
      action: "event_virtual_room.created",
      subjectType: "event_virtual_room",
      subjectId: replacement.id,
      aggregateId: eventOccurrenceId,
      metadata: {
        eventSessionId,
        generation: replacement.generation,
        replacesRoomId: room.id,
      },
      createdAt: currentNow,
    });
    return { status: "ready" } as const;
  });
}

type VirtualRoomOperationOutcome =
  | { status: "no-work" }
  | {
      status: "pending" | "processed" | "retry";
      operationId: string;
      roomId: string;
      kind: RoomOperationKind;
    };

export interface VirtualRoomOperationBatch {
  outcomes: Array<Exclude<VirtualRoomOperationOutcome, { status: "no-work" }>>;
  limitReached: boolean;
}

function recordingProviderFailureCode(error: unknown): string {
  if (error instanceof LiveKitRecordingProviderError)
    return `livekit_recording_${error.operation}`.slice(0, 120);
  return "livekit_recording_unavailable";
}

function laterDate(...dates: Array<Date | null>): Date {
  return new Date(
    Math.max(
      ...dates.filter((date): date is Date => Boolean(date)).map(Number),
    ),
  );
}

async function recordingStopRequestEvidence(
  transaction: Transaction<Database>,
  input: {
    roomId: string;
    recordingId: string;
    stopRequestedByUserId: string | null;
    stopRequestedAt: Date | null;
  },
) {
  if (input.stopRequestedByUserId && input.stopRequestedAt)
    return {
      stopRequestedByUserId: input.stopRequestedByUserId,
      stopRequestedAt: input.stopRequestedAt,
    };
  const operation = await transaction
    .selectFrom("event_virtual_room_operation")
    .select(["requestedByUserId", "createdAt"])
    .where("roomId", "=", input.roomId)
    .where("kind", "=", "stop_recording")
    .where("recordingId", "=", input.recordingId)
    .executeTakeFirst();
  return operation?.requestedByUserId
    ? {
        stopRequestedByUserId: operation.requestedByUserId,
        stopRequestedAt: operation.createdAt,
      }
    : {};
}

function recordingRetentionDeadline(
  completedAt: Date,
  retentionDays: number,
): Date {
  return new Date(completedAt.getTime() + retentionDays * 24 * 60 * 60_000);
}

function completedRecordingEvidenceValues(
  recording: { requestedAt: Date; retentionDays: number },
  snapshot: LiveKitRecordingSnapshot,
  observedAt: Date,
) {
  if (
    snapshot.status !== "complete" ||
    !snapshot.startedAt ||
    !snapshot.endedAt ||
    !snapshot.output
  )
    throw new LiveKitRecordingProviderError("list_recordings");
  const completedAt = laterDate(
    recording.requestedAt,
    snapshot.startedAt,
    snapshot.endedAt,
    observedAt,
  );
  return {
    status: "complete" as const,
    providerEgressId: snapshot.providerEgressId,
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt,
    completedAt,
    fileSizeBytes: snapshot.output.fileSizeBytes,
    durationNanoseconds: snapshot.output.durationNanoseconds,
    retentionDeadline: recordingRetentionDeadline(
      completedAt,
      recording.retentionDays,
    ),
    failureCode: null,
    updatedAt: completedAt,
  };
}

function failedRecordingEvidenceValues(
  recording: {
    requestedAt: Date;
    providerEgressId: string | null;
    startedAt: Date | null;
  },
  snapshot: LiveKitRecordingSnapshot,
  observedAt: Date,
) {
  if (snapshot.status !== "failed" || !snapshot.failureCode)
    throw new LiveKitRecordingProviderError("list_recordings");
  const startedAt = recording.startedAt ?? snapshot.startedAt;
  const completedAt = laterDate(
    recording.requestedAt,
    startedAt,
    snapshot.endedAt,
    observedAt,
  );
  return {
    status: "failed" as const,
    providerEgressId: recording.providerEgressId ?? snapshot.providerEgressId,
    startedAt,
    endedAt: snapshot.endedAt,
    completedAt,
    failureCode: snapshot.failureCode,
    updatedAt: completedAt,
  };
}

async function settleRecordingStart(
  claimed: ClaimedOperation,
  snapshot: LiveKitRecordingSnapshot,
  now: Date,
): Promise<boolean> {
  const recordingId = claimed.recordingId;
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const operation = await transaction
        .selectFrom("event_virtual_room_operation")
        .select(["status", "attempts"])
        .where("id", "=", claimed.id)
        .forUpdate()
        .executeTakeFirst();
      if (
        operation?.status !== "processing" ||
        operation.attempts !== claimed.attempts
      )
        return false;
      const recording = recordingId
        ? await transaction
            .selectFrom("event_virtual_recording")
            .select([
              "status",
              "requestedAt",
              "retentionDays",
              "eventSessionId",
              "roomGeneration",
              "stopRequestedByUserId",
              "stopRequestedAt",
            ])
            .select(["providerEgressId", "startedAt"])
            .where("id", "=", recordingId)
            .where("roomId", "=", claimed.roomId)
            .forUpdate()
            .executeTakeFirst()
        : undefined;
      if (recordingId && recording?.status === "requested") {
        const stopRequestEvidence = ["complete", "failed"].includes(
          snapshot.status,
        )
          ? await recordingStopRequestEvidence(transaction, {
              roomId: claimed.roomId,
              recordingId,
              stopRequestedByUserId: recording.stopRequestedByUserId,
              stopRequestedAt: recording.stopRequestedAt,
            })
          : {};
        if (snapshot.status === "complete") {
          const completion = completedRecordingEvidenceValues(
            recording,
            snapshot,
            now,
          );
          await transaction
            .updateTable("event_virtual_recording")
            .set({
              status: "starting",
              providerEgressId: snapshot.providerEgressId,
              startedAt: snapshot.startedAt,
              updatedAt: laterDate(recording.requestedAt, snapshot.startedAt),
            })
            .where("id", "=", recordingId)
            .executeTakeFirstOrThrow();
          await recordRecordingLifecycleAudit(transaction, {
            action: "event_virtual_recording.started",
            actorUserId: claimed.requestedByUserId,
            recordingId,
            roomId: claimed.roomId,
            eventSessionId: recording.eventSessionId,
            roomGeneration: recording.roomGeneration,
            status: "starting",
            previousStatus: recording.status,
            providerStatus: snapshot.status,
            createdAt: now,
          });
          await transaction
            .updateTable("event_virtual_recording")
            .set({ ...completion, ...stopRequestEvidence })
            .where("id", "=", recordingId)
            .executeTakeFirstOrThrow();
          await recordRecordingLifecycleAudit(transaction, {
            action: "event_virtual_recording.completed",
            actorUserId: claimed.requestedByUserId,
            recordingId,
            roomId: claimed.roomId,
            eventSessionId: recording.eventSessionId,
            roomGeneration: recording.roomGeneration,
            status: completion.status,
            previousStatus: "starting",
            providerStatus: snapshot.status,
            createdAt: completion.completedAt,
          });
        } else if (snapshot.status === "failed") {
          const failure = failedRecordingEvidenceValues(
            recording,
            snapshot,
            now,
          );
          if (failure.startedAt) {
            await transaction
              .updateTable("event_virtual_recording")
              .set({
                status: "starting",
                providerEgressId: failure.providerEgressId,
                startedAt: failure.startedAt,
                updatedAt: laterDate(recording.requestedAt, failure.startedAt),
              })
              .where("id", "=", recordingId)
              .executeTakeFirstOrThrow();
            await recordRecordingLifecycleAudit(transaction, {
              action: "event_virtual_recording.started",
              actorUserId: claimed.requestedByUserId,
              recordingId,
              roomId: claimed.roomId,
              eventSessionId: recording.eventSessionId,
              roomGeneration: recording.roomGeneration,
              status: "starting",
              previousStatus: recording.status,
              providerStatus: snapshot.status,
              createdAt: failure.startedAt,
            });
          }
          await transaction
            .updateTable("event_virtual_recording")
            .set({ ...failure, ...stopRequestEvidence })
            .where("id", "=", recordingId)
            .executeTakeFirstOrThrow();
          await recordRecordingLifecycleAudit(transaction, {
            action: "event_virtual_recording.failed",
            actorUserId: claimed.requestedByUserId,
            recordingId,
            roomId: claimed.roomId,
            eventSessionId: recording.eventSessionId,
            roomGeneration: recording.roomGeneration,
            status: failure.status,
            previousStatus: failure.startedAt ? "starting" : recording.status,
            providerStatus: snapshot.status,
            reasonCode: failure.failureCode,
            createdAt: failure.completedAt,
          });
        } else {
          if (snapshot.status === "stopping")
            throw new LiveKitRecordingProviderError("list_recordings");
          if (snapshot.status === "active" && !snapshot.startedAt)
            throw new LiveKitRecordingProviderError("list_recordings");
          const updatedAt = laterDate(
            recording.requestedAt,
            snapshot.startedAt,
            now,
          );
          await transaction
            .updateTable("event_virtual_recording")
            .set({
              status: "starting",
              providerEgressId: snapshot.providerEgressId,
              startedAt: snapshot.startedAt,
              updatedAt,
            })
            .where("id", "=", recordingId)
            .executeTakeFirstOrThrow();
          const status = snapshot.status;
          if (status === "active")
            await transaction
              .updateTable("event_virtual_recording")
              .set({ status, updatedAt })
              .where("id", "=", recordingId)
              .executeTakeFirstOrThrow();
          await recordRecordingLifecycleAudit(transaction, {
            action: "event_virtual_recording.started",
            actorUserId: claimed.requestedByUserId,
            recordingId,
            roomId: claimed.roomId,
            eventSessionId: recording.eventSessionId,
            roomGeneration: recording.roomGeneration,
            status,
            previousStatus: recording.status,
            providerStatus: snapshot.status,
            createdAt: updatedAt,
          });
        }
      }
      await transaction
        .updateTable("event_virtual_room_operation")
        .set({
          status: "succeeded",
          leasedUntil: null,
          completedAt: now,
          lastErrorCode: null,
        })
        .where("id", "=", claimed.id)
        .executeTakeFirstOrThrow();
      return true;
    });
}

async function reconcileRecordingStartSnapshot(
  claimed: ClaimedOperation,
  snapshot: LiveKitRecordingSnapshot,
  now: Date,
): Promise<"pending" | "processed" | "retry"> {
  if (snapshot.status === "stopping") {
    await retryRoomOperation(claimed, "recording_start_pending", now, false);
    return "retry";
  }
  return (await settleRecordingStart(claimed, snapshot, now))
    ? "processed"
    : "pending";
}

async function beginRecordingStartDispatch(
  claimed: ClaimedOperation,
  now: Date,
): Promise<"dispatch" | "settled" | "stale"> {
  const recordingId = claimed.recordingId;
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const room = await transaction
        .selectFrom("event_virtual_room")
        .select(["doorState", "endedAt", "replacedAt"])
        .where("id", "=", claimed.roomId)
        .forUpdate()
        .executeTakeFirst();
      const recording = recordingId
        ? await transaction
            .selectFrom("event_virtual_recording")
            .select([
              "status",
              "requestedAt",
              "eventSessionId",
              "roomGeneration",
              "stopRequestedByUserId",
              "stopRequestedAt",
            ])
            .where("id", "=", recordingId)
            .where("roomId", "=", claimed.roomId)
            .forUpdate()
            .executeTakeFirst()
        : undefined;
      const operation = await transaction
        .selectFrom("event_virtual_room_operation")
        .select(["status", "attempts", "recordingStartDispatchedAt"])
        .where("id", "=", claimed.id)
        .where("kind", "=", "start_recording")
        .forUpdate()
        .executeTakeFirst();
      if (
        operation?.status !== "processing" ||
        operation.attempts !== claimed.attempts ||
        operation.recordingStartDispatchedAt
      )
        return "stale";
      if (
        !room ||
        !recordingId ||
        !recording ||
        recording.status !== "requested"
      ) {
        await transaction
          .updateTable("event_virtual_room_operation")
          .set({
            status: "succeeded",
            leasedUntil: null,
            completedAt: now,
            lastErrorCode: null,
          })
          .where("id", "=", claimed.id)
          .executeTakeFirstOrThrow();
        return "settled";
      }
      if (room.doorState === "ended" || room.replacedAt) {
        const terminalAt = laterDate(
          recording.requestedAt,
          room.endedAt,
          room.replacedAt,
          now,
        );
        const stopRequestEvidence = await recordingStopRequestEvidence(
          transaction,
          {
            roomId: claimed.roomId,
            recordingId,
            stopRequestedByUserId: recording.stopRequestedByUserId,
            stopRequestedAt: recording.stopRequestedAt,
          },
        );
        await transaction
          .updateTable("event_virtual_recording")
          .set({
            status: "failed",
            completedAt: terminalAt,
            failureCode: "meeting_ended_before_recording_started",
            updatedAt: terminalAt,
            ...stopRequestEvidence,
          })
          .where("id", "=", recordingId)
          .executeTakeFirstOrThrow();
        await recordRecordingLifecycleAudit(transaction, {
          action: "event_virtual_recording.failed",
          actorUserId: claimed.requestedByUserId,
          recordingId,
          roomId: claimed.roomId,
          eventSessionId: recording.eventSessionId,
          roomGeneration: recording.roomGeneration,
          status: "failed",
          previousStatus: recording.status,
          reasonCode: "meeting_ended_before_recording_started",
          createdAt: terminalAt,
        });
        await transaction
          .updateTable("event_virtual_room_operation")
          .set({
            status: "succeeded",
            leasedUntil: null,
            completedAt: terminalAt,
            lastErrorCode: null,
          })
          .where("id", "=", claimed.id)
          .executeTakeFirstOrThrow();
        await transaction
          .updateTable("event_virtual_room_operation")
          .set({
            status: "succeeded",
            leasedUntil: null,
            completedAt: terminalAt,
            lastErrorCode: null,
          })
          .where("roomId", "=", claimed.roomId)
          .where("kind", "=", "stop_recording")
          .where("recordingId", "=", recordingId)
          .where("status", "=", "pending")
          .execute();
        return "settled";
      }
      await transaction
        .updateTable("event_virtual_room_operation")
        .set({ recordingStartDispatchedAt: now })
        .where("id", "=", claimed.id)
        .executeTakeFirstOrThrow();
      return "dispatch";
    });
}

async function failRecordingBeforeStart(
  claimed: ClaimedOperation,
  failureCode: string,
  now: Date,
): Promise<void> {
  await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const operation = await transaction
        .selectFrom("event_virtual_room_operation")
        .select(["status", "attempts"])
        .where("id", "=", claimed.id)
        .forUpdate()
        .executeTakeFirst();
      if (
        operation?.status !== "processing" ||
        operation.attempts !== claimed.attempts
      )
        return;
      if (claimed.recordingId) {
        const recording = await transaction
          .selectFrom("event_virtual_recording")
          .select([
            "status",
            "requestedAt",
            "eventSessionId",
            "roomGeneration",
            "stopRequestedByUserId",
            "stopRequestedAt",
          ])
          .where("id", "=", claimed.recordingId)
          .where("roomId", "=", claimed.roomId)
          .forUpdate()
          .executeTakeFirst();
        if (recording?.status === "requested") {
          const completedAt = laterDate(recording.requestedAt, now);
          const stopRequestEvidence = await recordingStopRequestEvidence(
            transaction,
            {
              roomId: claimed.roomId,
              recordingId: claimed.recordingId,
              stopRequestedByUserId: recording.stopRequestedByUserId,
              stopRequestedAt: recording.stopRequestedAt,
            },
          );
          await transaction
            .updateTable("event_virtual_recording")
            .set({
              status: "failed",
              completedAt,
              failureCode,
              updatedAt: completedAt,
              ...stopRequestEvidence,
            })
            .where("id", "=", claimed.recordingId)
            .executeTakeFirstOrThrow();
          await recordRecordingLifecycleAudit(transaction, {
            action: "event_virtual_recording.failed",
            actorUserId: claimed.requestedByUserId,
            recordingId: claimed.recordingId,
            roomId: claimed.roomId,
            eventSessionId: recording.eventSessionId,
            roomGeneration: recording.roomGeneration,
            status: "failed",
            previousStatus: recording.status,
            reasonCode: failureCode,
            createdAt: completedAt,
          });
          await transaction
            .updateTable("event_virtual_room_operation")
            .set({
              status: "succeeded",
              leasedUntil: null,
              completedAt,
              lastErrorCode: null,
            })
            .where("roomId", "=", claimed.roomId)
            .where("kind", "=", "stop_recording")
            .where("recordingId", "=", claimed.recordingId)
            .where("status", "=", "pending")
            .execute();
        }
      }
      await transaction
        .updateTable("event_virtual_room_operation")
        .set({
          status: "succeeded",
          leasedUntil: null,
          completedAt: now,
          lastErrorCode: null,
        })
        .where("id", "=", claimed.id)
        .executeTakeFirstOrThrow();
    });
}

async function executeRecordingStart(
  roomId: string,
  targetKey: string,
  runtime: VirtualRoomRuntime,
  now: Date,
): Promise<VirtualRoomOperationOutcome> {
  const claimed = await claimRoomOperation(
    roomId,
    "start_recording",
    now,
    targetKey,
  );
  if (!claimed) return { status: "no-work" };
  const target = claimed.recordingId
    ? await getDatabase()
        .selectFrom("event_virtual_recording as recording")
        .innerJoin("event_virtual_room as room", "room.id", "recording.roomId")
        .innerJoin(
          "event_session as session",
          "session.id",
          "room.eventSessionId",
        )
        .select([
          "recording.status",
          "recording.storageObjectKey",
          "room.providerRoomName",
          "room.doorState",
          "room.replacedAt",
          "room.startedAt",
          "session.startsAt as scheduledStartsAt",
          "session.endsAt as scheduledEndsAt",
        ])
        .where("recording.id", "=", claimed.recordingId)
        .where("recording.roomId", "=", roomId)
        .executeTakeFirst()
    : undefined;
  if (!target || target.status !== "requested") {
    await completeRoomOperation(claimed, now);
    return {
      status: "processed",
      operationId: claimed.id,
      roomId,
      kind: "start_recording",
    };
  }
  const recordingProvider = runtime.recordingProvider;
  if (!recordingProvider) {
    await retryRoomOperation(
      claimed,
      "livekit_recording_unavailable",
      now,
      false,
    );
    return {
      status: "retry",
      operationId: claimed.id,
      roomId,
      kind: "start_recording",
    };
  }
  let dispatchStarted = false;
  try {
    const snapshots = await recordingProvider.listRoomCompositeRecordings(
      target.providerRoomName,
      target.storageObjectKey,
    );
    const exact = snapshots.filter(
      (snapshot) =>
        snapshot.roomName === target.providerRoomName &&
        snapshot.storageObjectKey === target.storageObjectKey,
    );
    const exactSnapshot = exact[0];
    if (exact.length === 1 && exactSnapshot) {
      return {
        status: await reconcileRecordingStartSnapshot(
          claimed,
          exactSnapshot,
          now,
        ),
        operationId: claimed.id,
        roomId,
        kind: "start_recording",
      };
    }
    if (exact.length > 1 || snapshots.length > 0) {
      await retryRoomOperation(
        claimed,
        "unexpected_room_recording",
        now,
        false,
      );
      return {
        status: "retry",
        operationId: claimed.id,
        roomId,
        kind: "start_recording",
      };
    }
    if (
      claimed.recordingStartDispatchedAt &&
      (target.doorState === "ended" || target.replacedAt) &&
      now.getTime() - claimed.recordingStartDispatchedAt.getTime() >=
        RECORDING_START_RECONCILIATION_MILLISECONDS
    ) {
      await failRecordingBeforeStart(
        claimed,
        "meeting_ended_before_recording_started",
        now,
      );
      return {
        status: "processed",
        operationId: claimed.id,
        roomId,
        kind: "start_recording",
      };
    }
    if (claimed.recordingStartDispatchedAt) {
      await retryRoomOperation(
        claimed,
        "recording_start_outcome_unknown",
        now,
        false,
      );
      return {
        status: "retry",
        operationId: claimed.id,
        roomId,
        kind: "start_recording",
      };
    }
    if (target.doorState === "ended" || target.replacedAt) {
      await failRecordingBeforeStart(
        claimed,
        "meeting_ended_before_recording_started",
        now,
      );
      return {
        status: "processed",
        operationId: claimed.id,
        roomId,
        kind: "start_recording",
      };
    }
    const scheduledDuration =
      target.scheduledEndsAt.getTime() - target.scheduledStartsAt.getTime();
    const uploadAuthorizationExpiresAt = recordingUploadAuthorizationExpiresAt({
      authorizationStartsAt: target.startedAt ?? now,
      scheduledDurationMilliseconds: scheduledDuration,
      scheduledEndsAt: target.scheduledEndsAt,
      checkedAt: now,
      policy: recordingProvider.uploadAuthorizationPolicy,
    });
    if (!uploadAuthorizationExpiresAt) {
      await failRecordingBeforeStart(
        claimed,
        "upload_authorization_window_unsupported",
        now,
      );
      return {
        status: "processed",
        operationId: claimed.id,
        roomId,
        kind: "start_recording",
      };
    }
    const preparedStart = await recordingProvider.prepareRoomCompositeRecording(
      {
        roomName: target.providerRoomName,
        storageObjectKey: target.storageObjectKey,
        uploadAuthorizationExpiresAt,
        layout: "speaker",
        format: "mp4",
      },
    );
    const dispatchDecision = await beginRecordingStartDispatch(claimed, now);
    if (dispatchDecision !== "dispatch")
      return {
        status: dispatchDecision === "settled" ? "processed" : "pending",
        operationId: claimed.id,
        roomId,
        kind: "start_recording",
      };
    dispatchStarted = true;
    const snapshot = await preparedStart.dispatch();
    if (
      snapshot.roomName !== target.providerRoomName ||
      snapshot.storageObjectKey !== target.storageObjectKey
    )
      throw new LiveKitRecordingProviderError("start_recording");
    return {
      status: await reconcileRecordingStartSnapshot(claimed, snapshot, now),
      operationId: claimed.id,
      roomId,
      kind: "start_recording",
    };
  } catch (error) {
    await retryRoomOperation(
      claimed,
      dispatchStarted
        ? "recording_start_outcome_unknown"
        : recordingProviderFailureCode(error),
      now,
      false,
    );
    return {
      status: "retry",
      operationId: claimed.id,
      roomId,
      kind: "start_recording",
    };
  }
}

async function settleRecordingStop(
  claimed: ClaimedOperation,
  snapshot: LiveKitRecordingSnapshot,
  stopDispatchedAt: Date | null,
  now: Date,
): Promise<"pending" | "settled" | "stale"> {
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const operation = await transaction
        .selectFrom("event_virtual_room_operation")
        .select(["status", "attempts"])
        .where("id", "=", claimed.id)
        .forUpdate()
        .executeTakeFirst();
      if (
        operation?.status !== "processing" ||
        operation.attempts !== claimed.attempts
      )
        return "stale";
      let terminal = true;
      if (claimed.recordingId && claimed.requestedByUserId) {
        const recording = await transaction
          .selectFrom("event_virtual_recording")
          .select([
            "status",
            "requestedAt",
            "retentionDays",
            "eventSessionId",
            "roomGeneration",
            "providerEgressId",
            "startedAt",
            "stopRequestedByUserId",
            "stopRequestedAt",
          ])
          .where("id", "=", claimed.recordingId)
          .where("roomId", "=", claimed.roomId)
          .forUpdate()
          .executeTakeFirst();
        if (recording) {
          terminal = ["complete", "failed", "deleted"].includes(
            recording.status,
          );
          const stopRequestedByUserId =
            recording.stopRequestedByUserId ?? claimed.requestedByUserId;
          const stopRequestedAt =
            recording.stopRequestedAt ?? claimed.createdAt;
          if (!terminal) {
            const stopStartedAt =
              recording.stopRequestedAt === null ? stopDispatchedAt : null;
            if (snapshot.status === "complete") {
              const completion = completedRecordingEvidenceValues(
                recording,
                snapshot,
                now,
              );
              await transaction
                .updateTable("event_virtual_recording")
                .set({
                  ...completion,
                  stopRequestedByUserId,
                  stopRequestedAt,
                })
                .where("id", "=", claimed.recordingId)
                .executeTakeFirstOrThrow();
              if (stopStartedAt)
                await recordRecordingLifecycleAudit(transaction, {
                  action: "event_virtual_recording.stop_started",
                  actorUserId: claimed.requestedByUserId,
                  recordingId: claimed.recordingId,
                  roomId: claimed.roomId,
                  eventSessionId: recording.eventSessionId,
                  roomGeneration: recording.roomGeneration,
                  status: completion.status,
                  previousStatus: recording.status,
                  providerStatus: snapshot.status,
                  createdAt: stopStartedAt,
                });
              await recordRecordingLifecycleAudit(transaction, {
                action: "event_virtual_recording.completed",
                actorUserId: claimed.requestedByUserId,
                recordingId: claimed.recordingId,
                roomId: claimed.roomId,
                eventSessionId: recording.eventSessionId,
                roomGeneration: recording.roomGeneration,
                status: completion.status,
                previousStatus: recording.status,
                providerStatus: snapshot.status,
                createdAt: completion.completedAt,
              });
            } else if (snapshot.status === "failed") {
              const failure = failedRecordingEvidenceValues(
                recording,
                snapshot,
                now,
              );
              await transaction
                .updateTable("event_virtual_recording")
                .set({
                  ...failure,
                  stopRequestedByUserId,
                  stopRequestedAt,
                })
                .where("id", "=", claimed.recordingId)
                .executeTakeFirstOrThrow();
              if (stopStartedAt)
                await recordRecordingLifecycleAudit(transaction, {
                  action: "event_virtual_recording.stop_started",
                  actorUserId: claimed.requestedByUserId,
                  recordingId: claimed.recordingId,
                  roomId: claimed.roomId,
                  eventSessionId: recording.eventSessionId,
                  roomGeneration: recording.roomGeneration,
                  status: failure.status,
                  previousStatus: recording.status,
                  providerStatus: snapshot.status,
                  createdAt: stopStartedAt,
                });
              await recordRecordingLifecycleAudit(transaction, {
                action: "event_virtual_recording.failed",
                actorUserId: claimed.requestedByUserId,
                recordingId: claimed.recordingId,
                roomId: claimed.roomId,
                eventSessionId: recording.eventSessionId,
                roomGeneration: recording.roomGeneration,
                status: failure.status,
                previousStatus: recording.status,
                providerStatus: snapshot.status,
                reasonCode: failure.failureCode,
                createdAt: failure.completedAt,
              });
            } else {
              const updatedAt = laterDate(
                recording.requestedAt,
                claimed.createdAt,
                now,
              );
              await transaction
                .updateTable("event_virtual_recording")
                .set({
                  status: "stopping",
                  startedAt: recording.startedAt ?? snapshot.startedAt,
                  stopRequestedByUserId,
                  stopRequestedAt,
                  updatedAt,
                })
                .where("id", "=", claimed.recordingId)
                .executeTakeFirstOrThrow();
              if (stopStartedAt)
                await recordRecordingLifecycleAudit(transaction, {
                  action: "event_virtual_recording.stop_started",
                  actorUserId: claimed.requestedByUserId,
                  recordingId: claimed.recordingId,
                  roomId: claimed.roomId,
                  eventSessionId: recording.eventSessionId,
                  roomGeneration: recording.roomGeneration,
                  status: "stopping",
                  previousStatus: recording.status,
                  providerStatus: snapshot.status,
                  createdAt: stopStartedAt,
                });
            }
            terminal = ["complete", "failed"].includes(snapshot.status);
          }
        }
      }
      await transaction
        .updateTable("event_virtual_room_operation")
        .set(
          terminal
            ? {
                status: "succeeded",
                leasedUntil: null,
                completedAt: now,
                lastErrorCode: null,
              }
            : {
                status: "pending",
                availableAt: retryAt(claimed.attempts, now),
                leasedUntil: null,
                completedAt: null,
                lastErrorCode: "recording_stop_pending",
              },
        )
        .where("id", "=", claimed.id)
        .executeTakeFirstOrThrow();
      return terminal ? "settled" : "pending";
    });
}

async function beginRecordingStopDispatch(
  claimed: ClaimedOperation,
  now: Date,
): Promise<Date | null> {
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const operation = await transaction
        .selectFrom("event_virtual_room_operation")
        .select([
          "status",
          "attempts",
          "recordingStopDispatchedAt",
          "recordingStopOutcomeUnknownAt",
        ])
        .where("id", "=", claimed.id)
        .where("kind", "=", "stop_recording")
        .forUpdate()
        .executeTakeFirst();
      if (
        operation?.status !== "processing" ||
        operation.attempts !== claimed.attempts ||
        operation.recordingStopDispatchedAt ||
        operation.recordingStopOutcomeUnknownAt
      )
        return null;
      await transaction
        .updateTable("event_virtual_room_operation")
        .set({ recordingStopDispatchedAt: now })
        .where("id", "=", claimed.id)
        .executeTakeFirstOrThrow();
      return now;
    });
}

async function executeRecordingStop(
  roomId: string,
  targetKey: string,
  runtime: VirtualRoomRuntime,
  now: Date,
): Promise<VirtualRoomOperationOutcome> {
  const claimed = await claimRoomOperation(
    roomId,
    "stop_recording",
    now,
    targetKey,
  );
  if (!claimed) return { status: "no-work" };
  const target = claimed.recordingId
    ? await getDatabase()
        .selectFrom("event_virtual_recording as recording")
        .innerJoin("event_virtual_room as room", "room.id", "recording.roomId")
        .select([
          "recording.status",
          "recording.providerEgressId",
          "recording.storageObjectKey",
          "room.providerRoomName",
        ])
        .where("recording.id", "=", claimed.recordingId)
        .where("recording.roomId", "=", roomId)
        .executeTakeFirst()
    : undefined;
  if (!target || ["complete", "failed", "deleted"].includes(target.status)) {
    await completeRoomOperation(claimed, now);
    return {
      status: "processed",
      operationId: claimed.id,
      roomId,
      kind: "stop_recording",
    };
  }
  if (!target.providerEgressId) {
    await retryRoomOperation(claimed, "recording_start_pending", now, false);
    return {
      status: "retry",
      operationId: claimed.id,
      roomId,
      kind: "stop_recording",
    };
  }
  const recordingProvider = runtime.recordingProvider;
  if (!recordingProvider) {
    await retryRoomOperation(
      claimed,
      "livekit_recording_unavailable",
      now,
      false,
    );
    return {
      status: "retry",
      operationId: claimed.id,
      roomId,
      kind: "stop_recording",
    };
  }
  let stopDispatchStartedAt: Date | null = null;
  try {
    const exactSnapshot = await recordingProvider.getRoomCompositeRecording({
      roomName: target.providerRoomName,
      providerEgressId: target.providerEgressId,
      storageObjectKey: target.storageObjectKey,
    });
    if (!exactSnapshot) {
      await retryRoomOperation(
        claimed,
        "recording_target_unavailable",
        now,
        false,
      );
      return {
        status: "retry",
        operationId: claimed.id,
        roomId,
        kind: "stop_recording",
      };
    }
    const stopRequired = ["starting", "active"].includes(exactSnapshot.status);
    let stopDispatchedAt = claimed.recordingStopOutcomeUnknownAt
      ? claimed.recordingStopDispatchedAt
      : null;
    if (stopRequired) {
      if (claimed.recordingStopDispatchedAt) {
        await retryRoomOperation(
          claimed,
          claimed.recordingStopOutcomeUnknownAt
            ? "recording_stop_outcome_unknown"
            : "recording_stop_dispatch_pending",
          now,
          false,
        );
        return {
          status: "retry",
          operationId: claimed.id,
          roomId,
          kind: "stop_recording",
        };
      }
      stopDispatchedAt = await beginRecordingStopDispatch(claimed, now);
      if (!stopDispatchedAt)
        return {
          status: "pending",
          operationId: claimed.id,
          roomId,
          kind: "stop_recording",
        };
      stopDispatchStartedAt = stopDispatchedAt;
    }
    const stopSnapshot = stopRequired
      ? await recordingProvider.stopRoomCompositeRecording({
          roomName: target.providerRoomName,
          providerEgressId: target.providerEgressId,
          storageObjectKey: target.storageObjectKey,
        })
      : exactSnapshot;
    if (
      stopSnapshot.roomName !== target.providerRoomName ||
      stopSnapshot.providerEgressId !== target.providerEgressId ||
      stopSnapshot.storageObjectKey !== target.storageObjectKey
    )
      throw new LiveKitRecordingProviderError("stop_recording");
    const settlement = await settleRecordingStop(
      claimed,
      stopSnapshot,
      stopDispatchedAt,
      now,
    );
    return {
      status: settlement === "settled" ? "processed" : "pending",
      operationId: claimed.id,
      roomId,
      kind: "stop_recording",
    };
  } catch (error) {
    if (stopDispatchStartedAt)
      await retryAmbiguousRecordingStop(claimed, stopDispatchStartedAt, now);
    else
      await retryRoomOperation(
        claimed,
        recordingProviderFailureCode(error),
        now,
        false,
      );
    return {
      status: "retry",
      operationId: claimed.id,
      roomId,
      kind: "stop_recording",
    };
  }
}

async function executeCloseRoom(
  roomId: string,
  runtime: VirtualRoomRuntime,
  now: Date,
): Promise<VirtualRoomOperationOutcome> {
  const claimed = await claimRoomOperation(roomId, "close_room", now);
  if (!claimed) return { status: "no-work" };
  const ensureOperation = await getDatabase()
    .selectFrom("event_virtual_room_operation")
    .select(["status", "leasedUntil"])
    .where("roomId", "=", roomId)
    .where("kind", "=", "ensure_room")
    .executeTakeFirst();
  if (
    ensureOperation &&
    (ensureOperation.status === "pending" ||
      (ensureOperation.status === "processing" &&
        ensureOperation.leasedUntil &&
        ensureOperation.leasedUntil > now))
  ) {
    await retryRoomOperation(claimed, "ensure_room_pending", now, false);
    return {
      status: "retry",
      operationId: claimed.id,
      roomId,
      kind: "close_room",
    };
  }
  const room = await getDatabase()
    .selectFrom("event_virtual_room")
    .select("providerRoomName")
    .where("id", "=", roomId)
    .executeTakeFirst();
  if (!room) {
    await completeRoomOperation(claimed, now);
    return {
      status: "processed",
      operationId: claimed.id,
      roomId,
      kind: "close_room",
    };
  }
  try {
    await runtime.provider.closeRoom(room.providerRoomName);
    const enforcementPending = await getDatabase()
      .transaction()
      .execute(async (transaction) => {
        const lockedRoom = await transaction
          .selectFrom("event_virtual_room")
          .select(["id", "eventSessionId", "generation"])
          .where("id", "=", roomId)
          .forUpdate()
          .executeTakeFirst();
        const attendeeReservation = lockedRoom
          ? await transaction
              .selectFrom("event_virtual_lobby_entry as lobby")
              .innerJoin(
                "event_virtual_join_access as access",
                "access.id",
                "lobby.eventVirtualJoinAccessId",
              )
              .select("lobby.credentialExpiresAt")
              .where("access.eventSessionId", "=", lockedRoom.eventSessionId)
              .where("access.roomGeneration", "=", lockedRoom.generation)
              .where("lobby.credentialExpiresAt", ">", now)
              .orderBy("lobby.credentialExpiresAt", "desc")
              .executeTakeFirst()
          : undefined;
        const presenterReservation = lockedRoom
          ? await transaction
              .selectFrom("event_virtual_presenter_credential_reservation")
              .select("credentialExpiresAt")
              .where("roomId", "=", lockedRoom.id)
              .where("credentialExpiresAt", ">", now)
              .orderBy("credentialExpiresAt", "desc")
              .executeTakeFirst()
          : undefined;
        const reservationExpiry = [
          attendeeReservation?.credentialExpiresAt,
          presenterReservation?.credentialExpiresAt,
        ]
          .filter((expiry): expiry is Date => Boolean(expiry))
          .sort((left, right) => right.getTime() - left.getTime())[0];
        const keepEnforcing = Boolean(reservationExpiry);
        const operation = await transaction
          .updateTable("event_virtual_room_operation")
          .set(
            keepEnforcing && reservationExpiry
              ? {
                  status: "pending",
                  availableAt: new Date(
                    Math.min(
                      reservationExpiry.getTime(),
                      now.getTime() + TERMINAL_ROOM_RECHECK_MILLISECONDS,
                    ),
                  ),
                  leasedUntil: null,
                  completedAt: null,
                  lastErrorCode: null,
                  attempts: 0,
                }
              : {
                  status: "succeeded",
                  leasedUntil: null,
                  completedAt: now,
                  lastErrorCode: null,
                },
          )
          .where("id", "=", claimed.id)
          .where("status", "=", "processing")
          .where("attempts", "=", claimed.attempts)
          .executeTakeFirst();
        if (lockedRoom && operation.numUpdatedRows === 1n)
          await transaction
            .updateTable("event_virtual_room")
            .set({ providerStatus: "closed", providerErrorCode: null })
            .where("id", "=", roomId)
            .execute();
        return keepEnforcing && operation.numUpdatedRows === 1n;
      });
    return {
      status: enforcementPending ? "pending" : "processed",
      operationId: claimed.id,
      roomId,
      kind: "close_room",
    };
  } catch (error) {
    await retryRoomOperation(claimed, providerFailureCode(error), now);
    return {
      status: "retry",
      operationId: claimed.id,
      roomId,
      kind: "close_room",
    };
  }
}

async function executeParticipantRemoval(
  roomId: string,
  targetKey: string,
  runtime: VirtualRoomRuntime,
  now: Date,
): Promise<VirtualRoomOperationOutcome> {
  const claimed = await claimRoomOperation(
    roomId,
    "remove_participant",
    now,
    targetKey,
  );
  if (!claimed) return { status: "no-work" };
  if (
    !claimed.participantIdentity ||
    (!claimed.lobbyEntryId && !claimed.presenterUserId) ||
    !claimed.removalEnforcedUntil
  ) {
    await completeRoomOperation(claimed, now);
    return {
      status: "processed",
      operationId: claimed.id,
      roomId,
      kind: "remove_participant",
    };
  }
  if (claimed.presenterUserId) {
    const target = await getDatabase()
      .selectFrom("event_virtual_room as room")
      .innerJoin(
        "event_session as session",
        "session.id",
        "room.eventSessionId",
      )
      .innerJoin(
        "event_virtual_presenter_credential_reservation as reservation",
        (join) =>
          join
            .onRef("reservation.roomId", "=", "room.id")
            .on("reservation.userId", "=", claimed.presenterUserId),
      )
      .select([
        "room.providerRoomName",
        "room.eventSessionId",
        "session.eventOccurrenceId",
      ])
      .where("room.id", "=", roomId)
      .executeTakeFirst();
    if (
      !target ||
      (await hasVirtualRoomStaffAccess(
        getDatabase(),
        target.eventOccurrenceId,
        target.eventSessionId,
        claimed.presenterUserId,
      ))
    ) {
      await completeRoomOperation(claimed, now);
      return {
        status: "processed",
        operationId: claimed.id,
        roomId,
        kind: "remove_participant",
      };
    }
    try {
      await runtime.provider.removeParticipant(
        target.providerRoomName,
        claimed.participantIdentity,
      );
      if (claimed.removalEnforcedUntil > now) {
        await requeueParticipantRemoval(
          claimed,
          claimed.removalEnforcedUntil,
          now,
        );
        return {
          status: "pending",
          operationId: claimed.id,
          roomId,
          kind: "remove_participant",
        };
      }
      await completeRoomOperation(claimed, now);
      return {
        status: "processed",
        operationId: claimed.id,
        roomId,
        kind: "remove_participant",
      };
    } catch (error) {
      await retryRoomOperation(claimed, providerFailureCode(error), now, false);
      return {
        status: "retry",
        operationId: claimed.id,
        roomId,
        kind: "remove_participant",
      };
    }
  }
  if (!claimed.lobbyEntryId) {
    await completeRoomOperation(claimed, now);
    return {
      status: "processed",
      operationId: claimed.id,
      roomId,
      kind: "remove_participant",
    };
  }
  const target = await getDatabase()
    .selectFrom("event_virtual_room as room")
    .innerJoin(
      "event_virtual_lobby_entry as lobby",
      "lobby.eventSessionId",
      "room.eventSessionId",
    )
    .select(["room.providerRoomName", "lobby.state", "lobby.admittedByUserId"])
    .where("room.id", "=", roomId)
    .where("lobby.id", "=", claimed.lobbyEntryId)
    .whereRef("lobby.roomGeneration", "=", "room.generation")
    .executeTakeFirst();
  if (
    !target ||
    (target.admittedByUserId !== null &&
      ["admitted", "token_issued", "connected", "left"].includes(target.state))
  ) {
    await completeRoomOperation(claimed, now);
    return {
      status: "processed",
      operationId: claimed.id,
      roomId,
      kind: "remove_participant",
    };
  }
  try {
    await runtime.provider.removeParticipant(
      target.providerRoomName,
      claimed.participantIdentity,
    );
    if (claimed.removalEnforcedUntil > now) {
      await requeueParticipantRemoval(
        claimed,
        claimed.removalEnforcedUntil,
        now,
      );
      return {
        status: "pending",
        operationId: claimed.id,
        roomId,
        kind: "remove_participant",
      };
    }
    await completeRoomOperation(claimed, now);
    return {
      status: "processed",
      operationId: claimed.id,
      roomId,
      kind: "remove_participant",
    };
  } catch (error) {
    await retryRoomOperation(claimed, providerFailureCode(error), now, false);
    return {
      status: "retry",
      operationId: claimed.id,
      roomId,
      kind: "remove_participant",
    };
  }
}

async function requeueParticipantRemoval(
  claimed: ClaimedOperation,
  credentialExpiresAt: Date,
  now: Date,
): Promise<void> {
  await getDatabase()
    .updateTable("event_virtual_room_operation")
    .set({
      status: "pending",
      availableAt: new Date(
        Math.min(
          credentialExpiresAt.getTime(),
          now.getTime() + PARTICIPANT_REVOCATION_RECHECK_MILLISECONDS,
        ),
      ),
      leasedUntil: null,
      completedAt: null,
      lastErrorCode: null,
      attempts: 0,
    })
    .where("id", "=", claimed.id)
    .where("status", "=", "processing")
    .where("attempts", "=", claimed.attempts)
    .execute();
}

async function processNextEventVirtualRoomOperation(
  options: { runtime?: VirtualRoomRuntime; now?: Date } = {},
): Promise<VirtualRoomOperationOutcome> {
  const now = options.now ?? new Date();
  const candidate = await getDatabase()
    .selectFrom("event_virtual_room_operation")
    .select(["id", "roomId", "kind", "targetKey"])
    .where((expression) =>
      expression.or([
        expression.and([
          expression("status", "=", "pending"),
          expression("availableAt", "<=", now),
        ]),
        expression.and([
          expression("status", "=", "processing"),
          expression("leasedUntil", "<=", now),
        ]),
      ]),
    )
    .orderBy("availableAt")
    .orderBy(
      sql<number>`case "kind"
        when 'ensure_room' then 0
        when 'start_recording' then 1
        when 'stop_recording' then 2
        when 'remove_participant' then 3
        when 'close_room' then 4
        else 5 end`,
    )
    .orderBy("createdAt")
    .executeTakeFirst();
  if (!candidate) return { status: "no-work" };
  let runtime: VirtualRoomRuntime | null;
  try {
    runtime = options.runtime ?? resolveConfiguredRuntime();
  } catch {
    runtime = null;
  }
  if (!runtime) {
    const claimed = await claimRoomOperation(
      candidate.roomId,
      candidate.kind,
      now,
      candidate.targetKey,
    );
    if (!claimed) return { status: "no-work" };
    await retryRoomOperation(
      claimed,
      "livekit_unavailable",
      now,
      !["remove_participant", "start_recording", "stop_recording"].includes(
        candidate.kind,
      ),
    );
    return {
      status: "retry",
      operationId: claimed.id,
      roomId: claimed.roomId,
      kind: claimed.kind,
    };
  }
  if (candidate.kind === "remove_participant")
    return executeParticipantRemoval(
      candidate.roomId,
      candidate.targetKey,
      runtime,
      now,
    );
  if (candidate.kind === "start_recording")
    return executeRecordingStart(
      candidate.roomId,
      candidate.targetKey,
      runtime,
      now,
    );
  if (candidate.kind === "stop_recording")
    return executeRecordingStop(
      candidate.roomId,
      candidate.targetKey,
      runtime,
      now,
    );
  if (candidate.kind === "close_room")
    return executeCloseRoom(candidate.roomId, runtime, now);
  const result = await executeEnsureRoom(candidate.roomId, runtime, now);
  if (result === "pending") return { status: "no-work" };
  return {
    status: result === "ready" || result === "ended" ? "processed" : "retry",
    operationId: candidate.id,
    roomId: candidate.roomId,
    kind: candidate.kind,
  };
}

export async function processAvailableEventVirtualRoomOperations(
  limit = 10,
  options: { runtime?: VirtualRoomRuntime; now?: Date } = {},
): Promise<VirtualRoomOperationBatch> {
  const outcomes: VirtualRoomOperationBatch["outcomes"] = [];
  for (let index = 0; index < limit; index += 1) {
    const outcome = await processNextEventVirtualRoomOperation(options);
    if (outcome.status === "no-work") break;
    outcomes.push(outcome);
  }
  return { outcomes, limitReached: outcomes.length === limit };
}

export async function checkEventVirtualSessionProviderHealth(
  eventOccurrenceId: string,
  eventSessionId: string,
  userId: string,
  runtimeOverride?: VirtualRoomRuntime,
): Promise<EventVirtualRoomMutationOutcome> {
  const database = getDatabase();
  const context = await findVirtualSessionContext(
    database,
    eventOccurrenceId,
    eventSessionId,
  );
  if (!context) return { status: "not-found" };
  if (context === "not-livekit")
    return { status: "conflict", reason: "not_livekit" };
  if (
    !(await hasVirtualRoomStaffAccess(
      database,
      eventOccurrenceId,
      eventSessionId,
      userId,
    ))
  )
    return { status: "forbidden" };
  let runtime: VirtualRoomRuntime | null;
  try {
    runtime = runtimeOverride ?? resolveConfiguredRuntime();
  } catch {
    runtime = null;
  }
  if (!runtime) return { status: "conflict", reason: "provider_unavailable" };
  try {
    await runtime.provider.checkHealth();
    return { status: "ready" };
  } catch {
    return { status: "conflict", reason: "provider_unavailable" };
  }
}
