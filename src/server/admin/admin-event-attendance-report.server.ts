import "@tanstack/react-start/server-only";

import type {
  AdminEventAttendanceFilter,
  AdminEventAttendanceDecisionEvidence,
  AdminEventAttendanceIntervalEvidence,
  AdminEventAttendanceReport,
} from "#/features/admin-event/admin-event-operations.schema";
import { filterAdminEventAttendanceRows } from "#/features/admin-event/admin-event-attendance-report";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import type { Kysely, Transaction } from "kysely";

function evidenceKey(eventSessionId: string, eventParticipationId: string) {
  return `${eventSessionId}\u0000${eventParticipationId}`;
}

async function readAdminEventAttendanceReport(
  database: Kysely<Database> | Transaction<Database>,
  eventOccurrenceId: string,
): Promise<AdminEventAttendanceReport | null> {
  const occurrence = await database
    .selectFrom("event_occurrence")
    .select(["id", "title", "timezone"])
    .where("id", "=", eventOccurrenceId)
    .executeTakeFirst();
  if (!occurrence) return null;

  const [sessions, participations, attendance, decisions, intervals] =
    await Promise.all([
      database
        .selectFrom("event_session")
        .select(["id", "title", "startsAt", "endsAt"])
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .orderBy("position")
        .execute(),
      database
        .selectFrom("event_participation")
        .select([
          "id",
          "nameSnapshot as name",
          "emailSnapshot as email",
          "mode",
        ])
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .orderBy("nameSnapshot")
        .orderBy("emailSnapshot")
        .execute(),
      database
        .selectFrom("event_attendance as attendance")
        .innerJoin(
          "event_session as session",
          "session.id",
          "attendance.eventSessionId",
        )
        .leftJoin("user as actor", "actor.id", "attendance.recordedByUserId")
        .select([
          "attendance.eventParticipationId",
          "attendance.eventSessionId",
          "attendance.state",
          "attendance.source",
          "attendance.recordedAt",
          "attendance.updatedAt",
          "actor.name as recordedByName",
        ])
        .where("session.eventOccurrenceId", "=", eventOccurrenceId)
        .execute(),
      database
        .selectFrom("event_virtual_attendance_decision as decision")
        .select([
          "decision.id",
          "decision.eventSessionId",
          "decision.eventParticipationId",
          "decision.roomGeneration",
          "decision.attendanceState",
          "decision.attendanceMode",
          "decision.attendanceMinimumMinutes",
          "decision.qualifyingConnectedSeconds",
          "decision.calculationVersion",
          "decision.decisionAt",
          "decision.applicationOutcome",
          "decision.previousAttendanceState",
          "decision.previousAttendanceSource",
        ])
        .where("decision.eventOccurrenceId", "=", eventOccurrenceId)
        .orderBy("decision.decisionAt")
        .execute(),
      database
        .selectFrom("event_virtual_connection_interval as interval")
        .select([
          "interval.id",
          "interval.eventSessionId",
          "interval.eventParticipationId",
          "interval.roomGeneration",
          "interval.joinedAt",
          "interval.leftAt",
          "interval.joinedSource",
          "interval.leftSource",
        ])
        .where("interval.eventOccurrenceId", "=", eventOccurrenceId)
        .orderBy("interval.joinedAt")
        .execute(),
    ]);

  const attendanceByScope = new Map(
    attendance.map((row) => [
      evidenceKey(row.eventSessionId, row.eventParticipationId),
      row,
    ]),
  );
  const decisionsByScope = new Map<
    string,
    Array<AdminEventAttendanceDecisionEvidence>
  >();
  for (const decision of decisions) {
    const key = evidenceKey(
      decision.eventSessionId,
      decision.eventParticipationId,
    );
    const scoped = decisionsByScope.get(key) ?? [];
    scoped.push({
      id: decision.id,
      roomGeneration: decision.roomGeneration,
      attendanceState: decision.attendanceState,
      attendanceMode: decision.attendanceMode,
      attendanceMinimumMinutes: decision.attendanceMinimumMinutes,
      qualifyingConnectedSeconds: decision.qualifyingConnectedSeconds,
      calculationVersion: decision.calculationVersion,
      decisionAt: decision.decisionAt.toISOString(),
      applicationOutcome: decision.applicationOutcome,
      previousAttendanceState: decision.previousAttendanceState,
      previousAttendanceSource: decision.previousAttendanceSource,
    });
    decisionsByScope.set(key, scoped);
  }
  const intervalsByScope = new Map<
    string,
    Array<AdminEventAttendanceIntervalEvidence>
  >();
  for (const interval of intervals) {
    const key = evidenceKey(
      interval.eventSessionId,
      interval.eventParticipationId,
    );
    const scoped = intervalsByScope.get(key) ?? [];
    scoped.push({
      id: interval.id,
      roomGeneration: interval.roomGeneration,
      joinedAt: interval.joinedAt.toISOString(),
      leftAt: interval.leftAt?.toISOString() ?? null,
      joinedSource: interval.joinedSource,
      leftSource: interval.leftSource,
    });
    intervalsByScope.set(key, scoped);
  }

  return {
    occurrence,
    sessions: sessions.map((session) => ({
      ...session,
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
    })),
    rows: sessions.flatMap((session) =>
      participations.map((participation) => {
        const key = evidenceKey(session.id, participation.id);
        const current = attendanceByScope.get(key);
        return {
          eventParticipationId: participation.id,
          eventSessionId: session.id,
          sessionTitle: session.title,
          sessionStartsAt: session.startsAt.toISOString(),
          sessionEndsAt: session.endsAt.toISOString(),
          name: participation.name,
          email: participation.email,
          participationMode: participation.mode,
          state: current?.state ?? "not_recorded",
          source: current?.source ?? null,
          recordedByName: current?.recordedByName ?? null,
          recordedAt: current?.recordedAt.toISOString() ?? null,
          updatedAt: current?.updatedAt.toISOString() ?? null,
          decisions: decisionsByScope.get(key) ?? [],
          intervals: intervalsByScope.get(key) ?? [],
        };
      }),
    ),
  };
}

export async function findAdminEventAttendanceReport(
  eventOccurrenceId: string,
): Promise<AdminEventAttendanceReport | null> {
  return await readAdminEventAttendanceReport(getDatabase(), eventOccurrenceId);
}

export async function exportAdminEventAttendanceReport(
  eventOccurrenceId: string,
  filters: AdminEventAttendanceFilter,
  administrator: AuthenticatedUser,
): Promise<AdminEventAttendanceReport | null> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const report = await readAdminEventAttendanceReport(
        transaction,
        eventOccurrenceId,
      );
      if (!report) return null;
      const rowCount = filterAdminEventAttendanceRows(
        report.rows,
        filters,
      ).length;
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_attendance.report_exported",
        subjectType: "event_occurrence",
        subjectId: eventOccurrenceId,
        metadata: {
          format: "csv",
          rowCount,
          searchApplied: filters.q.length > 0,
          sessionId: filters.sessionId,
          state: filters.state,
          evidence: filters.evidence,
        },
      });
      return report;
    });
}
