import "@tanstack/react-start/server-only";

import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import {
  createConfiguredLiveKitProvider,
  getEnabledLiveKitConfiguration,
  LiveKitProviderError,
  type LiveKitProvider,
} from "#/server/livekit/livekit-provider.server";
import type { EventOperationsAccess } from "./event-operations-access.server";
import { ensureEventVirtualJoinAccess } from "./event-virtual-join-access.server";
import { admitEligibleWaitingEntries } from "./event-virtual-lobby-admission.server";
import { hasVirtualRoomStaffAccess } from "./event-virtual-staff-access.server";

const PROVIDER_OPERATION_LEASE_MILLISECONDS = 2 * 60 * 1_000;
const PROVIDER_RETRY_MAX_SECONDS = 15 * 60;
const PARTICIPANT_REVOCATION_RECHECK_MILLISECONDS = 5 * 1_000;
const ROOM_EMPTY_TIMEOUT_SECONDS = 10 * 60;
const ROOM_DEPARTURE_TIMEOUT_SECONDS = 20;

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
  | "recording_unavailable"
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

export interface EventVirtualSessionOperations {
  eventSessionId: string;
  preparationOpensAt: string;
  canEnterGreenRoom: boolean;
  lobbyPath: string | null;
  room: EventVirtualRoomState | null;
}

const LOBBY_QUEUE_PAGE_SIZE = 50;

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
    .selectFrom("event_virtual_join_access")
    .select("id")
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("eventSessionId", "=", eventSessionId)
    .where("revokedAt", "is", null)
    .executeTakeFirst();
  if (!access) return { status: "not-found" } as const;
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
}

export interface VirtualRoomRuntime {
  provider: LiveKitProvider;
  websocketUrl: string;
  approvedMaxParticipants: number;
}

interface ClaimedOperation {
  id: string;
  roomId: string;
  kind: "ensure_room" | "close_room" | "remove_participant";
  targetKey: string;
  lobbyEntryId: string | null;
  participantIdentity: string | null;
  attempts: number;
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

function presenterIdentity(roomId: string, userId: string): string {
  return `staff_${createHash("sha256")
    .update(`${roomId}:${userId}`)
    .digest("hex")}`;
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
  kind: "ensure_room" | "close_room" | "remove_participant",
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
        participantIdentity: operation.participantIdentity,
        attempts,
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
      lobbyPath: accessRecord
        ? `/webinars/${accessRecord.publicReference}`
        : null,
      room: room ? roomState(room) : null,
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

  const database = getDatabase();
  const room = await database
    .selectFrom("event_virtual_room")
    .select(["id", "generation", "providerRoomName", "providerStatus"])
    .where("eventSessionId", "=", eventSessionId)
    .where("replacedAt", "is", null)
    .where("doorState", "!=", "ended")
    .executeTakeFirst();
  if (!room || room.providerStatus !== "ready")
    return { status: "conflict", reason: "room_not_ready" };
  if (
    !(await hasVirtualRoomStaffAccess(
      database,
      eventOccurrenceId,
      eventSessionId,
      user.id,
    ))
  )
    return { status: "forbidden" };

  try {
    const providerCredential = await runtime.provider.createJoinToken({
      roomName: room.providerRoomName,
      participantIdentity: presenterIdentity(room.id, user.id),
      displayName: user.name.trim().slice(0, 200) || "Presenter",
      role: "presenter",
    });
    const credentialStillAuthorised = await database
      .transaction()
      .execute(async (transaction) => {
        const occurrence = await transaction
          .selectFrom("event_occurrence")
          .select("id")
          .where("id", "=", eventOccurrenceId)
          .forUpdate()
          .executeTakeFirst();
        if (!occurrence) return "occurrence_unavailable" as const;
        const currentContext = await findVirtualSessionContext(
          transaction,
          eventOccurrenceId,
          eventSessionId,
        );
        if (!currentContext || currentContext === "not-livekit")
          return "occurrence_unavailable" as const;
        const currentRoom = await transaction
          .selectFrom("event_virtual_room")
          .select("id")
          .where("id", "=", room.id)
          .where("eventSessionId", "=", eventSessionId)
          .where("replacedAt", "is", null)
          .where("doorState", "!=", "ended")
          .where("providerStatus", "=", "ready")
          .forUpdate()
          .executeTakeFirst();
        if (!currentRoom) return "room-not-ready" as const;
        if (
          !(await hasVirtualRoomStaffAccess(
            transaction,
            eventOccurrenceId,
            eventSessionId,
            user.id,
          ))
        )
          return "forbidden" as const;
        const currentNow = clock();
        const currentConflict = preparationConflict(currentContext, currentNow);
        if (currentConflict) return currentConflict;
        await recordDurableAuditEvent(transaction, {
          actorUserId: user.id,
          action: "event_virtual_room.presenter_token_issued",
          subjectType: "event_virtual_room",
          subjectId: room.id,
          aggregateId: eventOccurrenceId,
          metadata: { eventSessionId, generation: room.generation },
          createdAt: currentNow,
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
          .select("doorState")
          .where("eventSessionId", "=", eventSessionId)
          .where("replacedAt", "is", null)
          .forUpdate()
          .executeTakeFirst();
        return room?.doorState === "open"
          ? ({ status: "ready" } as const)
          : null;
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
      if (room.recordingMode === "automatic")
        return { status: "conflict", reason: "recording_unavailable" } as const;
    }
    await transaction
      .updateTable("event_virtual_room")
      .set(transitionValues(action, user.id, currentNow))
      .where("id", "=", room.id)
      .executeTakeFirstOrThrow();
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
      return { status: "ready" } as const;
    await transaction
      .updateTable("event_virtual_room")
      .set({ admissionMode })
      .where("id", "=", room.id)
      .execute();
    if (admissionMode === "automatic")
      await admitEligibleWaitingEntries(transaction, {
        eventOccurrenceId,
        eventSessionId,
        roomGeneration: room.generation,
        actorUserId: user.id,
        now: currentNow,
        source: "automatic_mode_enabled",
      });
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
    return { status: "ready" } as const;
  });
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
      kind: "ensure_room" | "close_room" | "remove_participant";
    };

export interface VirtualRoomOperationBatch {
  outcomes: Array<Exclude<VirtualRoomOperationOutcome, { status: "no-work" }>>;
  limitReached: boolean;
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
    await getDatabase()
      .transaction()
      .execute(async (transaction) => {
        const lockedRoom = await transaction
          .selectFrom("event_virtual_room")
          .select("id")
          .where("id", "=", roomId)
          .forUpdate()
          .executeTakeFirst();
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
        if (lockedRoom && operation.numUpdatedRows === 1n)
          await transaction
            .updateTable("event_virtual_room")
            .set({ providerStatus: "closed", providerErrorCode: null })
            .where("id", "=", roomId)
            .execute();
      });
    return {
      status: "processed",
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
  if (!claimed.lobbyEntryId || !claimed.participantIdentity) {
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
    .select([
      "room.providerRoomName",
      "lobby.state",
      "lobby.credentialExpiresAt",
    ])
    .where("room.id", "=", roomId)
    .where("lobby.id", "=", claimed.lobbyEntryId)
    .whereRef("lobby.roomGeneration", "=", "room.generation")
    .executeTakeFirst();
  if (!target || target.state !== "revoked") {
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
    if (target.credentialExpiresAt && target.credentialExpiresAt > now) {
      await getDatabase()
        .updateTable("event_virtual_room_operation")
        .set({
          status: "pending",
          availableAt: new Date(
            Math.min(
              target.credentialExpiresAt.getTime(),
              now.getTime() + PARTICIPANT_REVOCATION_RECHECK_MILLISECONDS,
            ),
          ),
          leasedUntil: null,
          completedAt: null,
          lastErrorCode: null,
        })
        .where("id", "=", claimed.id)
        .where("status", "=", "processing")
        .where("attempts", "=", claimed.attempts)
        .execute();
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
      candidate.kind !== "remove_participant",
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
