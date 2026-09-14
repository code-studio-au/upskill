import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { completeEventParticipationIfReady } from "#/server/learning/event-learning-completion.server";
import {
  createConfiguredLiveKitProvider,
  LiveKitProviderError,
  type LiveKitParticipantSnapshot,
  type LiveKitProvider,
} from "#/server/livekit/livekit-provider.server";
import {
  eventVirtualParticipantIdentityDigest,
  isEventVirtualAttendeeIdentity,
} from "./event-virtual-participant-identity.server";
import { projectEventVirtualLobbyPresence } from "./event-virtual-connection-presence.server";

const RECONCILIATION_LEASE_MILLISECONDS = 2 * 60_000;
const RECONCILIATION_INTERVAL_MILLISECONDS = 30_000;
const RECONCILIATION_RETRY_MAX_SECONDS = 15 * 60;
const EVENT_VIRTUAL_ATTENDANCE_CALCULATION_VERSION = 1;

type AttendanceMode = "manual" | "automatic_check_in" | "automatic_duration";
type AttendanceState = "not_recorded" | "checked_in" | "attended" | "absent";
type AttendanceSource =
  "system" | "self_check_in" | "coordinator" | "presenter" | "administrator";

type DatabaseConnection = Kysely<Database> | Transaction<Database>;

export interface ConnectionIntervalWindow {
  joinedAt: Date;
  leftAt: Date | null;
}

export function qualifyingConnectedMilliseconds(
  intervals: ConnectionIntervalWindow[],
  windowStart: Date,
  windowEnd: Date,
): number {
  if (windowEnd <= windowStart) return 0;
  const bounded = intervals
    .map((interval) => ({
      start: Math.max(interval.joinedAt.getTime(), windowStart.getTime()),
      end: Math.min(
        (interval.leftAt ?? windowEnd).getTime(),
        windowEnd.getTime(),
      ),
    }))
    .filter(({ start, end }) => end > start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let total = 0;
  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  for (const interval of bounded) {
    if (currentStart === null || currentEnd === null) {
      currentStart = interval.start;
      currentEnd = interval.end;
      continue;
    }
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }
    total += currentEnd - currentStart;
    currentStart = interval.start;
    currentEnd = interval.end;
  }
  if (currentStart !== null && currentEnd !== null)
    total += currentEnd - currentStart;
  return total;
}

function retryAt(attempts: number, now: Date): Date {
  const seconds = Math.min(
    30 * 2 ** Math.max(0, attempts - 1),
    RECONCILIATION_RETRY_MAX_SECONDS,
  );
  return new Date(now.getTime() + seconds * 1_000);
}

async function findAutomaticRoom(
  connection: DatabaseConnection,
  roomId: string,
) {
  return await connection
    .selectFrom("event_virtual_room as room")
    .innerJoin("event_session as session", "session.id", "room.eventSessionId")
    .select([
      "room.id",
      "room.eventSessionId",
      "room.generation",
      "room.providerRoomName",
      "room.providerStatus",
      "room.doorState",
      "room.attendanceMode",
      "room.attendanceMinimumMinutes",
      "room.startedAt",
      "room.endedAt",
      "room.replacedAt",
      "session.eventOccurrenceId",
      "session.startsAt as scheduledStartsAt",
    ])
    .where("room.id", "=", roomId)
    .executeTakeFirst();
}

export async function ensureEventVirtualAttendanceReconciliation(
  transaction: Transaction<Database>,
  roomId: string,
  now: Date,
): Promise<void> {
  const room = await transaction
    .selectFrom("event_virtual_room")
    .select(["attendanceMode", "startedAt"])
    .where("id", "=", roomId)
    .executeTakeFirst();
  if (!room?.startedAt || room.attendanceMode === "manual") return;
  await transaction
    .insertInto("event_virtual_attendance_reconciliation")
    .values({
      roomId,
      status: "pending",
      evidenceRevision: 0,
      reconciledRevision: 0,
      attempts: 0,
      availableAt: now,
      leasedUntil: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      completedAt: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflict((conflict) => conflict.column("roomId").doNothing())
    .execute();
}

export async function wakeEventVirtualAttendanceReconciliation(
  transaction: Transaction<Database>,
  roomId: string,
  now: Date,
  evidenceChanged = true,
): Promise<void> {
  await ensureEventVirtualAttendanceReconciliation(transaction, roomId, now);
  await transaction
    .updateTable("event_virtual_attendance_reconciliation")
    .set((expression) => ({
      ...(evidenceChanged
        ? {
            evidenceRevision: expression("evidenceRevision", "+", 1),
          }
        : {}),
      status: sql`case when status = 'processing' then status else 'pending' end`,
      availableAt: sql`case
        when status = 'processing' then "availableAt"
        else least("availableAt", ${now})
      end`,
      leasedUntil: sql`case when status = 'processing' then "leasedUntil" else null end`,
      completedAt: null,
      updatedAt: now,
    }))
    .where("roomId", "=", roomId)
    .execute();
}

type ClaimedReconciliation = {
  roomId: string;
  attempts: number;
  evidenceRevision: number;
};

async function claimReconciliation(
  database: Kysely<Database>,
  now: Date,
): Promise<ClaimedReconciliation | null> {
  return database.transaction().execute(async (transaction) => {
    const candidate = await transaction
      .selectFrom("event_virtual_attendance_reconciliation")
      .select(["roomId", "attempts", "evidenceRevision"])
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
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!candidate) return null;
    const attempts = candidate.attempts + 1;
    await transaction
      .updateTable("event_virtual_attendance_reconciliation")
      .set({
        status: "processing",
        attempts,
        lastAttemptAt: now,
        leasedUntil: new Date(
          now.getTime() + RECONCILIATION_LEASE_MILLISECONDS,
        ),
        completedAt: null,
        updatedAt: now,
      })
      .where("roomId", "=", candidate.roomId)
      .executeTakeFirstOrThrow();
    return {
      roomId: candidate.roomId,
      attempts,
      evidenceRevision: candidate.evidenceRevision,
    };
  });
}

async function retryReconciliation(
  database: Kysely<Database>,
  claimed: ClaimedReconciliation,
  errorCode: string,
  now: Date,
): Promise<void> {
  await database
    .updateTable("event_virtual_attendance_reconciliation")
    .set({
      status: "pending",
      availableAt: retryAt(claimed.attempts, now),
      leasedUntil: null,
      completedAt: null,
      lastErrorCode: errorCode,
      updatedAt: now,
    })
    .where("roomId", "=", claimed.roomId)
    .where("status", "=", "processing")
    .where("attempts", "=", claimed.attempts)
    .execute();
}

function providerFailureCode(error: unknown): string {
  if (error instanceof LiveKitProviderError)
    return `livekit_${error.operation}`.slice(0, 120);
  return "livekit_attendance_reconciliation_failed";
}

function terminalAt(room: {
  endedAt: Date | null;
  replacedAt: Date | null;
}): Date | null {
  const values = [room.endedAt, room.replacedAt].filter(
    (value): value is Date => Boolean(value),
  );
  return values.length
    ? new Date(Math.min(...values.map((value) => value.getTime())))
    : null;
}

async function applyAttendanceDecision(
  transaction: Transaction<Database>,
  input: {
    roomId: string;
    eventVirtualJoinAccessId: string;
    eventOccurrenceId: string;
    eventSessionId: string;
    roomGeneration: number;
    lobbyEntryId: string;
    eventParticipationId: string;
    attendanceMode: Exclude<AttendanceMode, "manual">;
    attendanceMinimumMinutes: number | null;
    attendanceState: "checked_in" | "attended";
    qualifyingConnectedSeconds: number;
    decisionAt: Date;
  },
): Promise<void> {
  const existingDecision = await transaction
    .selectFrom("event_virtual_attendance_decision")
    .select("id")
    .where("roomId", "=", input.roomId)
    .where("eventParticipationId", "=", input.eventParticipationId)
    .where("attendanceState", "=", input.attendanceState)
    .where(
      "calculationVersion",
      "=",
      EVENT_VIRTUAL_ATTENDANCE_CALCULATION_VERSION,
    )
    .executeTakeFirst();
  if (existingDecision) return;

  const previous = await transaction
    .selectFrom("event_attendance")
    .select(["state", "source"])
    .where("eventParticipationId", "=", input.eventParticipationId)
    .where("eventSessionId", "=", input.eventSessionId)
    .forUpdate()
    .executeTakeFirst();
  const staffSource =
    previous?.source === "coordinator" ||
    previous?.source === "presenter" ||
    previous?.source === "administrator";
  const alreadySatisfied =
    previous?.state === "attended" ||
    (input.attendanceState === "checked_in" &&
      previous?.state === "checked_in");
  const applicationOutcome = staffSource
    ? "preserved_manual"
    : alreadySatisfied
      ? "already_satisfied"
      : "applied";

  const inserted = await transaction
    .insertInto("event_virtual_attendance_decision")
    .values({
      id: `event_virtual_attendance_decision_${randomUUID()}`,
      roomId: input.roomId,
      eventVirtualJoinAccessId: input.eventVirtualJoinAccessId,
      eventOccurrenceId: input.eventOccurrenceId,
      eventSessionId: input.eventSessionId,
      roomGeneration: input.roomGeneration,
      lobbyEntryId: input.lobbyEntryId,
      eventParticipationId: input.eventParticipationId,
      attendanceState: input.attendanceState,
      attendanceMode: input.attendanceMode,
      attendanceMinimumMinutes: input.attendanceMinimumMinutes,
      qualifyingConnectedSeconds: input.qualifyingConnectedSeconds,
      calculationVersion: EVENT_VIRTUAL_ATTENDANCE_CALCULATION_VERSION,
      decisionAt: input.decisionAt,
      applicationOutcome,
      previousAttendanceState: previous?.state ?? null,
      previousAttendanceSource: previous?.source ?? null,
    })
    .onConflict((conflict) =>
      conflict
        .columns([
          "roomId",
          "eventParticipationId",
          "attendanceState",
          "calculationVersion",
        ])
        .doNothing(),
    )
    .returning("id")
    .executeTakeFirst();
  if (!inserted || applicationOutcome !== "applied") return;

  const attendanceValues = {
    state: input.attendanceState as AttendanceState,
    source: "system" as AttendanceSource,
    recordedByUserId: null,
    updatedAt: input.decisionAt,
  };
  if (previous)
    await transaction
      .updateTable("event_attendance")
      .set(attendanceValues)
      .where("eventParticipationId", "=", input.eventParticipationId)
      .where("eventSessionId", "=", input.eventSessionId)
      .executeTakeFirstOrThrow();
  else
    await transaction
      .insertInto("event_attendance")
      .values({
        eventParticipationId: input.eventParticipationId,
        eventSessionId: input.eventSessionId,
        ...attendanceValues,
        recordedAt: input.decisionAt,
      })
      .executeTakeFirstOrThrow();
  if (input.attendanceState === "checked_in")
    await transaction
      .updateTable("event_participation")
      .set({ checkedInAt: input.decisionAt })
      .where("id", "=", input.eventParticipationId)
      .where("checkedInAt", "is", null)
      .execute();
  await recordDurableAuditEvent(transaction, {
    actorUserId: null,
    action: "event_attendance.recorded",
    subjectType: "event_attendance",
    subjectId: `${input.eventParticipationId}:${input.eventSessionId}`,
    aggregateId: input.eventOccurrenceId,
    metadata: {
      state: input.attendanceState,
      source: "system",
      attendancePolicy: input.attendanceMode,
      attendanceMinimumMinutes: input.attendanceMinimumMinutes,
      qualifyingConnectedSeconds: input.qualifyingConnectedSeconds,
      calculationVersion: EVENT_VIRTUAL_ATTENDANCE_CALCULATION_VERSION,
      roomId: input.roomId,
      roomGeneration: input.roomGeneration,
      connectionBased: true,
    },
    createdAt: input.decisionAt,
  });
  if (input.attendanceState === "attended")
    await completeEventParticipationIfReady(
      transaction,
      {
        eventParticipationId: input.eventParticipationId,
        source: "attendance",
      },
      input.decisionAt,
    );
}

async function reconcileRoomEvidenceAndAttendance(
  database: Kysely<Database>,
  claimed: ClaimedReconciliation,
  participants: LiveKitParticipantSnapshot[],
  observedAt: Date,
): Promise<{ final: boolean; superseded: boolean }> {
  return database.transaction().execute(async (transaction) => {
    const work = await transaction
      .selectFrom("event_virtual_attendance_reconciliation")
      .select(["status", "attempts", "evidenceRevision"])
      .where("roomId", "=", claimed.roomId)
      .forUpdate()
      .executeTakeFirst();
    if (work?.status !== "processing" || work.attempts !== claimed.attempts)
      return { final: false, superseded: true };
    if (work.evidenceRevision !== claimed.evidenceRevision) {
      await transaction
        .updateTable("event_virtual_attendance_reconciliation")
        .set({
          status: "pending",
          attempts: 0,
          availableAt: observedAt,
          leasedUntil: null,
          completedAt: null,
          lastErrorCode: null,
          updatedAt: observedAt,
        })
        .where("roomId", "=", claimed.roomId)
        .where("status", "=", "processing")
        .where("attempts", "=", claimed.attempts)
        .executeTakeFirstOrThrow();
      return { final: false, superseded: true };
    }
    const room = await findAutomaticRoom(transaction, claimed.roomId);
    if (!room || room.attendanceMode === "manual" || !room.startedAt) {
      await transaction
        .updateTable("event_virtual_attendance_reconciliation")
        .set({
          status: "succeeded",
          attempts: 0,
          reconciledRevision: work.evidenceRevision,
          leasedUntil: null,
          lastSuccessAt: observedAt,
          completedAt: observedAt,
          lastErrorCode: null,
          updatedAt: observedAt,
        })
        .where("roomId", "=", claimed.roomId)
        .executeTakeFirstOrThrow();
      return { final: true, superseded: false };
    }
    await transaction
      .selectFrom("event_occurrence")
      .select("id")
      .where("id", "=", room.eventOccurrenceId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const access = await transaction
      .selectFrom("event_virtual_join_access")
      .select("id")
      .where("eventOccurrenceId", "=", room.eventOccurrenceId)
      .where("eventSessionId", "=", room.eventSessionId)
      .where("roomGeneration", "=", room.generation)
      .executeTakeFirst();
    const terminal = terminalAt(room);
    const evidenceAt =
      terminal && terminal < observedAt ? terminal : observedAt;
    const lobbyEntries = access
      ? await transaction
          .selectFrom("event_virtual_lobby_entry as lobby")
          .innerJoin(
            "event_participation as participation",
            "participation.id",
            "lobby.eventParticipationId",
          )
          .leftJoin(
            "event_registration as registration",
            "registration.id",
            "participation.registrationId",
          )
          .select([
            "lobby.id",
            "lobby.eventVirtualJoinAccessId",
            "lobby.eventOccurrenceId",
            "lobby.eventSessionId",
            "lobby.roomGeneration",
            "lobby.eventParticipationId",
            "lobby.participantIdentityDigest",
            "lobby.state",
            "lobby.firstConnectedAt",
            "lobby.lastSeenAt",
            "lobby.leftAt",
            "lobby.updatedAt",
          ])
          .where("lobby.eventVirtualJoinAccessId", "=", access.id)
          .where("lobby.participantIdentityDigest", "is not", null)
          .where((expression) =>
            expression.or([
              expression("participation.mode", "=", "open_entry"),
              expression("registration.status", "=", "selected"),
            ]),
          )
          .forUpdate("lobby")
          .execute()
      : [];
    const lobbyByDigest = new Map(
      lobbyEntries.flatMap((entry) =>
        entry.participantIdentityDigest
          ? [[entry.participantIdentityDigest, entry] as const]
          : [],
      ),
    );
    const attendeeParticipants = participants.flatMap((participant) => {
      if (!isEventVirtualAttendeeIdentity(participant.identity)) return [];
      const digest = eventVirtualParticipantIdentityDigest(
        participant.identity,
      );
      const lobby = lobbyByDigest.get(digest);
      return lobby ? [{ participant, digest, lobby }] : [];
    });
    const activeSids = new Set(
      attendeeParticipants.map(({ participant }) => participant.sid),
    );
    const existingIntervals = await transaction
      .selectFrom("event_virtual_connection_interval")
      .select([
        "id",
        "providerParticipantSid",
        "lobbyEntryId",
        "joinedAt",
        "leftAt",
      ])
      .where("roomId", "=", room.id)
      .forUpdate()
      .execute();
    const intervalBySid = new Map(
      existingIntervals.map((interval) => [
        interval.providerParticipantSid,
        interval,
      ]),
    );
    const affectedLobbyIds = new Set<string>();
    for (const { participant, digest, lobby } of attendeeParticipants) {
      if (intervalBySid.has(participant.sid)) continue;
      await transaction
        .insertInto("event_virtual_connection_interval")
        .values({
          id: `event_virtual_connection_interval_${randomUUID()}`,
          roomId: room.id,
          eventVirtualJoinAccessId: lobby.eventVirtualJoinAccessId,
          eventOccurrenceId: lobby.eventOccurrenceId,
          eventSessionId: lobby.eventSessionId,
          roomGeneration: lobby.roomGeneration,
          lobbyEntryId: lobby.id,
          eventParticipationId: lobby.eventParticipationId,
          providerParticipantSid: participant.sid,
          participantIdentityDigest: digest,
          joinedReceiptId: null,
          joinedSource: "provider_reconciliation",
          leftReceiptId: null,
          leftSource: terminal ? "room_end" : null,
          joinedAt: evidenceAt,
          leftAt: terminal ? evidenceAt : null,
          createdAt: observedAt,
          updatedAt: observedAt,
        })
        .onConflict((conflict) =>
          conflict.columns(["roomId", "providerParticipantSid"]).doNothing(),
        )
        .execute();
      affectedLobbyIds.add(lobby.id);
    }
    for (const interval of existingIntervals) {
      if (interval.leftAt) continue;
      const shouldClose =
        terminal !== null || !activeSids.has(interval.providerParticipantSid);
      if (!shouldClose) continue;
      const leftAt = new Date(
        Math.max(interval.joinedAt.getTime(), evidenceAt.getTime()),
      );
      await transaction
        .updateTable("event_virtual_connection_interval")
        .set({
          leftAt,
          leftReceiptId: null,
          leftSource: terminal ? "room_end" : "provider_reconciliation",
          updatedAt: observedAt,
        })
        .where("id", "=", interval.id)
        .where("leftAt", "is", null)
        .execute();
      affectedLobbyIds.add(interval.lobbyEntryId);
    }
    for (const entry of lobbyEntries)
      if (affectedLobbyIds.has(entry.id))
        await projectEventVirtualLobbyPresence(transaction, entry, observedAt);

    for (const entry of lobbyEntries) {
      const intervals = await transaction
        .selectFrom("event_virtual_connection_interval")
        .select(["joinedAt", "leftAt"])
        .where("eventSessionId", "=", room.eventSessionId)
        .where("eventParticipationId", "=", entry.eventParticipationId)
        .execute();
      if (!intervals.length) continue;
      const qualifyingMilliseconds = qualifyingConnectedMilliseconds(
        intervals,
        room.scheduledStartsAt,
        evidenceAt,
      );
      const qualifyingConnectedSeconds = Math.floor(
        qualifyingMilliseconds / 1_000,
      );
      await applyAttendanceDecision(transaction, {
        roomId: room.id,
        eventVirtualJoinAccessId: entry.eventVirtualJoinAccessId,
        eventOccurrenceId: room.eventOccurrenceId,
        eventSessionId: room.eventSessionId,
        roomGeneration: room.generation,
        lobbyEntryId: entry.id,
        eventParticipationId: entry.eventParticipationId,
        attendanceMode: room.attendanceMode,
        attendanceMinimumMinutes: room.attendanceMinimumMinutes,
        attendanceState: "checked_in",
        qualifyingConnectedSeconds,
        decisionAt: observedAt,
      });
      if (
        room.attendanceMode === "automatic_duration" &&
        room.attendanceMinimumMinutes !== null &&
        qualifyingMilliseconds >= room.attendanceMinimumMinutes * 60_000
      )
        await applyAttendanceDecision(transaction, {
          roomId: room.id,
          eventVirtualJoinAccessId: entry.eventVirtualJoinAccessId,
          eventOccurrenceId: room.eventOccurrenceId,
          eventSessionId: room.eventSessionId,
          roomGeneration: room.generation,
          lobbyEntryId: entry.id,
          eventParticipationId: entry.eventParticipationId,
          attendanceMode: room.attendanceMode,
          attendanceMinimumMinutes: room.attendanceMinimumMinutes,
          attendanceState: "attended",
          qualifyingConnectedSeconds,
          decisionAt: observedAt,
        });
    }

    await transaction
      .updateTable("event_virtual_attendance_reconciliation")
      .set({
        status: terminal ? "succeeded" : "pending",
        attempts: 0,
        reconciledRevision: work.evidenceRevision,
        availableAt: terminal
          ? observedAt
          : new Date(
              observedAt.getTime() + RECONCILIATION_INTERVAL_MILLISECONDS,
            ),
        leasedUntil: null,
        lastSuccessAt: observedAt,
        completedAt: terminal ? observedAt : null,
        lastErrorCode: null,
        updatedAt: observedAt,
      })
      .where("roomId", "=", claimed.roomId)
      .executeTakeFirstOrThrow();
    return { final: Boolean(terminal), superseded: false };
  });
}

type EventVirtualAttendanceReconciliationOutcome =
  | { status: "processed" | "pending"; roomId: string }
  | { status: "retry"; roomId: string; reasonCode: string };

export interface EventVirtualAttendanceReconciliationBatch {
  outcomes: EventVirtualAttendanceReconciliationOutcome[];
  limitReached: boolean;
}

async function processNextReconciliation(
  database: Kysely<Database>,
  provider: LiveKitProvider | null,
  now: Date,
): Promise<EventVirtualAttendanceReconciliationOutcome | null> {
  const claimed = await claimReconciliation(database, now);
  if (!claimed) return null;
  try {
    const room = await findAutomaticRoom(database, claimed.roomId);
    const participants =
      !room ||
      !room.startedAt ||
      room.attendanceMode === "manual" ||
      room.providerStatus === "closed"
        ? []
        : await (provider
            ? provider.listParticipants(room.providerRoomName)
            : Promise.reject(new LiveKitProviderError("list_participants")));
    const result = await reconcileRoomEvidenceAndAttendance(
      database,
      claimed,
      participants,
      now,
    );
    if (result.superseded) return null;
    return {
      status: result.final ? "processed" : "pending",
      roomId: claimed.roomId,
    };
  } catch (error) {
    const reasonCode = providerFailureCode(error);
    await retryReconciliation(database, claimed, reasonCode, now);
    return { status: "retry", roomId: claimed.roomId, reasonCode };
  }
}

export async function processAvailableEventVirtualAttendanceReconciliations(
  limit = 10,
  options: {
    database?: Kysely<Database>;
    provider?: LiveKitProvider | null;
    now?: Date;
  } = {},
): Promise<EventVirtualAttendanceReconciliationBatch> {
  const database = options.database ?? getDatabase();
  const now = options.now ?? new Date();
  const provider =
    options.provider === undefined
      ? createConfiguredLiveKitProvider()
      : options.provider;
  const outcomes: EventVirtualAttendanceReconciliationOutcome[] = [];
  for (let index = 0; index < limit; index += 1) {
    const outcome = await processNextReconciliation(database, provider, now);
    if (!outcome) break;
    outcomes.push(outcome);
  }
  return { outcomes, limitReached: outcomes.length === limit };
}

export async function isEventVirtualAttendanceReconciliationComplete(
  connection: DatabaseConnection,
  roomId: string,
): Promise<boolean> {
  const room = await connection
    .selectFrom("event_virtual_room")
    .select(["attendanceMode", "startedAt"])
    .where("id", "=", roomId)
    .executeTakeFirst();
  if (!room?.startedAt || room.attendanceMode === "manual") return true;
  return Boolean(
    await connection
      .selectFrom("event_virtual_attendance_reconciliation")
      .select("roomId")
      .where("roomId", "=", roomId)
      .where("status", "=", "succeeded")
      .whereRef("reconciledRevision", "=", "evidenceRevision")
      .executeTakeFirst(),
  );
}
