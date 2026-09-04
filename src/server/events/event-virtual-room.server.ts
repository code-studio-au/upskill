import "@tanstack/react-start/server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import {
  createConfiguredLiveKitProvider,
  getEnabledLiveKitConfiguration,
  LIVEKIT_JOIN_TOKEN_TTL_SECONDS,
  LiveKitProviderError,
  type LiveKitProvider,
} from "#/server/livekit/livekit-provider.server";
import type { EventOperationsAccess } from "./event-operations-access.server";

const PROVIDER_OPERATION_LEASE_MILLISECONDS = 2 * 60 * 1_000;
const PROVIDER_RETRY_MAX_SECONDS = 15 * 60;
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
  | "room_not_ready"
  | "session_ended";

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
  room: EventVirtualRoomState | null;
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
  kind: "ensure_room" | "close_room";
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
): EventVirtualRoomConflictReason | null {
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

async function hasVirtualRoomStaffAccess(
  connection: DatabaseConnection,
  eventOccurrenceId: string,
  eventSessionId: string,
  userId: string,
): Promise<boolean> {
  const [platformAdministrator, presenter] = await Promise.all([
    connection
      .selectFrom("platform_admin")
      .select("userId")
      .where("userId", "=", userId)
      .executeTakeFirst(),
    connection
      .selectFrom("event_presenter_assignment")
      .select("id")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .where("userId", "=", userId)
      .where("endedAt", "is", null)
      .where((expression) =>
        expression.or([
          expression("eventSessionId", "=", eventSessionId),
          expression("eventSessionId", "is", null),
        ]),
      )
      .executeTakeFirst(),
  ]);
  return Boolean(presenter || platformAdministrator);
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
    .onConflict((conflict) => conflict.columns(["roomId", "kind"]).doNothing())
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
  context: VirtualSessionContext,
  userId: string,
  maxParticipants: number,
  now: Date,
  replacesRoomId: string | null = null,
) {
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      await transaction
        .selectFrom("event_session")
        .select("id")
        .where("id", "=", context.eventSessionId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const existing = await currentRoom(transaction, context.eventSessionId);
      if (existing) return existing;
      const maximum = await transaction
        .selectFrom("event_virtual_room")
        .select((expression) =>
          expression.fn.max<number>("generation").as("maximum"),
        )
        .where("eventSessionId", "=", context.eventSessionId)
        .executeTakeFirst();
      const generation = (maximum?.maximum ?? 0) + 1;
      const roomId = `event_virtual_room_${randomUUID()}`;
      const room = await transaction
        .insertInto("event_virtual_room")
        .values({
          id: roomId,
          eventSessionId: context.eventSessionId,
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
          createdAt: now,
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
      await insertRoomOperation(
        transaction,
        room.id,
        "ensure_room",
        userId,
        now,
      );
      await recordDurableAuditEvent(transaction, {
        actorUserId: userId,
        action: "event_virtual_room.created",
        subjectType: "event_virtual_room",
        subjectId: room.id,
        aggregateId: context.eventOccurrenceId,
        metadata: {
          eventSessionId: context.eventSessionId,
          generation,
          replacesRoomId,
        },
        createdAt: now,
      });
      return room;
    });
}

async function claimRoomOperation(
  roomId: string,
  kind: "ensure_room" | "close_room",
  now: Date,
): Promise<ClaimedOperation | null> {
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const operation = await transaction
        .selectFrom("event_virtual_room_operation")
        .selectAll()
        .where("roomId", "=", roomId)
        .where("kind", "=", kind)
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
      return { id: operation.id, roomId, kind, attempts };
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

async function queueCompensatingRoomClose(
  roomId: string,
  now: Date,
): Promise<void> {
  await getDatabase()
    .transaction()
    .execute(async (transaction) => {
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
          lastErrorCode: "stale_ensure_requires_close",
        })
        .where("id", "=", existing.id)
        .executeTakeFirstOrThrow();
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
    if (!completion.currentClaim || !completion.roomOperational) {
      await compensateEnsuredRoom(room.id, room.providerRoomName, runtime, now);
      return completion.currentClaim ? "ended" : "pending";
    }
    return "ready";
  } catch (error) {
    await retryRoomOperation(claimed, providerFailureCode(error), now);
    return "failed";
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
  return authorised.map((session) => {
    const opensAt = new Date(
      session.startsAt.getTime() -
        (session.livekitPresenterPreparationMinutes ?? 0) * 60 * 1_000,
    );
    const room = roomBySession.get(session.id);
    return {
      eventSessionId: session.id,
      preparationOpensAt: opensAt.toISOString(),
      canEnterGreenRoom:
        session.occurrenceStatus === "published" &&
        now >= opensAt &&
        now < session.endsAt &&
        room?.doorState !== "ended",
      room: room ? roomState(room) : null,
    };
  });
}

export async function ensureEventVirtualRoomForStaff(
  eventOccurrenceId: string,
  eventSessionId: string,
  user: AuthenticatedUser,
  options: { runtime?: VirtualRoomRuntime; now?: Date } = {},
): Promise<EventVirtualRoomMutationOutcome> {
  const now = options.now ?? new Date();
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
  const room =
    (await currentRoom(database, eventSessionId)) ??
    (await createRoomGeneration(context, user.id, maxParticipants, now));
  if (room.doorState === "ended")
    return { status: "conflict", reason: "session_ended" };
  const readiness = await executeEnsureRoom(room.id, runtime, now);
  if (readiness === "pending")
    return { status: "conflict", reason: "provider_pending" };
  if (readiness !== "ready")
    return { status: "conflict", reason: "provider_unavailable" };

  return { status: "ready" };
}

export async function issueEventVirtualPresenterCredential(
  eventOccurrenceId: string,
  eventSessionId: string,
  user: AuthenticatedUser,
  options: { runtime?: VirtualRoomRuntime; now?: Date } = {},
): Promise<EventVirtualPresenterCredentialOutcome> {
  const now = options.now ?? new Date();
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
    { runtime, now },
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
    const token = await runtime.provider.createJoinToken({
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
        const currentConflict = preparationConflict(currentContext, now);
        if (currentConflict) return currentConflict;
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
        await recordDurableAuditEvent(transaction, {
          actorUserId: user.id,
          action: "event_virtual_room.presenter_token_issued",
          subjectType: "event_virtual_room",
          subjectId: room.id,
          aggregateId: eventOccurrenceId,
          metadata: { eventSessionId, generation: room.generation },
          createdAt: now,
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
        token,
        websocketUrl: runtime.websocketUrl,
        generation: room.generation,
        expiresAt: new Date(
          now.getTime() + LIVEKIT_JOIN_TOKEN_TTL_SECONDS * 1_000,
        ).toISOString(),
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
  now = new Date(),
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
      user.id,
    ))
  )
    return { status: "forbidden" };
  if (context.occurrenceStatus !== "published")
    return { status: "conflict", reason: "occurrence_unavailable" };
  if (action === "start" && now >= context.endsAt)
    return { status: "conflict", reason: "session_ended" };
  return database.transaction().execute(async (transaction) => {
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
      .set(transitionValues(action, user.id, now))
      .where("id", "=", room.id)
      .executeTakeFirstOrThrow();
    if (action === "end")
      await insertRoomOperation(
        transaction,
        room.id,
        "close_room",
        user.id,
        now,
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
      createdAt: now,
    });
    return { status: "ready" } as const;
  });
}

export async function setEventVirtualRoomAdmissionMode(
  eventOccurrenceId: string,
  eventSessionId: string,
  admissionMode: "manual" | "automatic",
  user: AuthenticatedUser,
  now = new Date(),
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
      user.id,
    ))
  )
    return { status: "forbidden" };
  if (context.occurrenceStatus !== "published")
    return { status: "conflict", reason: "occurrence_unavailable" };
  return database.transaction().execute(async (transaction) => {
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
    if (room.doorState === "ended")
      return { status: "conflict", reason: "invalid_transition" } as const;
    if (room.admissionMode === admissionMode)
      return { status: "ready" } as const;
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
      createdAt: now,
    });
    return { status: "ready" } as const;
  });
}

export async function replaceEventVirtualRoom(
  eventOccurrenceId: string,
  eventSessionId: string,
  user: AuthenticatedUser,
  now = new Date(),
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
      user.id,
    ))
  )
    return { status: "forbidden" };
  if (context.occurrenceStatus !== "published")
    return { status: "conflict", reason: "occurrence_unavailable" };

  return database.transaction().execute(async (transaction) => {
    await transaction
      .selectFrom("event_session")
      .select("id")
      .where("id", "=", eventSessionId)
      .forUpdate()
      .executeTakeFirstOrThrow();
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
    if (room.providerStatus !== "error" || room.doorState === "ended")
      return { status: "conflict", reason: "invalid_transition" } as const;

    await transaction
      .updateTable("event_virtual_room")
      .set({
        doorState: "ended",
        endedByUserId: room.endedByUserId ?? user.id,
        endedAt: room.endedAt ?? now,
        replacedByUserId: user.id,
        replacedAt: now,
      })
      .where("id", "=", room.id)
      .executeTakeFirstOrThrow();
    await insertRoomOperation(transaction, room.id, "close_room", user.id, now);

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
        createdAt: now,
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
    await insertRoomOperation(
      transaction,
      replacement.id,
      "ensure_room",
      user.id,
      now,
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
      createdAt: now,
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
      createdAt: now,
    });
    return { status: "ready" } as const;
  });
}

type VirtualRoomOperationOutcome =
  | { status: "no-work" }
  | {
      status: "processed" | "retry";
      operationId: string;
      roomId: string;
      kind: "ensure_room" | "close_room";
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
        if (operation.numUpdatedRows === 1n)
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

async function processNextEventVirtualRoomOperation(
  options: { runtime?: VirtualRoomRuntime; now?: Date } = {},
): Promise<VirtualRoomOperationOutcome> {
  const now = options.now ?? new Date();
  const candidate = await getDatabase()
    .selectFrom("event_virtual_room_operation")
    .select(["id", "roomId", "kind"])
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
    );
    if (!claimed) return { status: "no-work" };
    await retryRoomOperation(claimed, "livekit_unavailable", now);
    return {
      status: "retry",
      operationId: claimed.id,
      roomId: claimed.roomId,
      kind: claimed.kind,
    };
  }
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
