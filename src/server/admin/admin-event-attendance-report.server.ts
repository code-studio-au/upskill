import "@tanstack/react-start/server-only";

import type {
  AdminEventAttendanceFilter,
  AdminEventAttendanceDecisionEvidence,
  AdminEventAttendanceIntervalEvidence,
  AdminEventAttendanceReport,
  AdminEventAttendanceReportQuery,
  AdminEventAttendanceReviewRow,
} from "#/features/admin-event/admin-event-operations.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { sql, type Kysely, type Transaction } from "kysely";

const ATTENDANCE_REPORT_PAGE_SIZE = 25;

function evidenceKey(eventSessionId: string, eventParticipationId: string) {
  return `${eventSessionId}\u0000${eventParticipationId}`;
}

function searchPattern(query: string): string {
  return `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

const automaticEvidenceExists = sql<boolean>`exists (
  select 1
    from event_virtual_attendance_decision decision_evidence
    where decision_evidence."eventSessionId" = session.id
      and decision_evidence."eventParticipationId" = participation.id
)`;
const intervalEvidenceExists = sql<boolean>`exists (
  select 1
    from event_virtual_connection_interval interval_evidence
    where interval_evidence."eventSessionId" = session.id
      and interval_evidence."eventParticipationId" = participation.id
)`;
const estimatedEvidenceExists = sql<boolean>`exists (
  select 1
    from event_virtual_connection_interval estimated_evidence
    where estimated_evidence."eventSessionId" = session.id
      and estimated_evidence."eventParticipationId" = participation.id
      and (
        estimated_evidence."joinedSource" = 'provider_reconciliation'
        or estimated_evidence."leftSource" in ('provider_reconciliation', 'room_end')
      )
)`;

function attendanceRowsQuery(
  database: Kysely<Database> | Transaction<Database>,
  eventOccurrenceId: string,
  filters: AdminEventAttendanceFilter,
) {
  const pattern = searchPattern(filters.q);
  return database
    .selectFrom("event_session as session")
    .innerJoin("event_participation as participation", (join) =>
      join.onRef(
        "participation.eventOccurrenceId",
        "=",
        "session.eventOccurrenceId",
      ),
    )
    .leftJoin("event_attendance as attendance", (join) =>
      join
        .onRef("attendance.eventSessionId", "=", "session.id")
        .onRef("attendance.eventParticipationId", "=", "participation.id"),
    )
    .leftJoin("user as actor", "actor.id", "attendance.recordedByUserId")
    .where("session.eventOccurrenceId", "=", eventOccurrenceId)
    .$if(filters.q.length > 0, (query) =>
      query.where((expression) =>
        expression.or([
          expression("participation.nameSnapshot", "ilike", pattern),
          expression("participation.emailSnapshot", "ilike", pattern),
          expression("session.title", "ilike", pattern),
        ]),
      ),
    )
    .$if(filters.sessionId !== "all", (query) =>
      query.where("session.id", "=", filters.sessionId),
    )
    .$if(filters.state !== "all", (query) =>
      query.where(
        sql<boolean>`coalesce(attendance.state, 'not_recorded') = ${filters.state}`,
      ),
    )
    .$if(filters.evidence === "automatic", (query) =>
      query.where(automaticEvidenceExists),
    )
    .$if(filters.evidence === "staff", (query) =>
      query.where("attendance.source", "in", [
        "administrator",
        "coordinator",
        "presenter",
      ]),
    )
    .$if(filters.evidence === "estimated", (query) =>
      query.where(estimatedEvidenceExists),
    )
    .$if(filters.evidence === "none", (query) =>
      query
        .where(sql<boolean>`not (${automaticEvidenceExists})`)
        .where(sql<boolean>`not (${intervalEvidenceExists})`),
    );
}

async function readAdminEventAttendanceReport(
  database: Kysely<Database> | Transaction<Database>,
  eventOccurrenceId: string,
  filters: AdminEventAttendanceFilter,
  requestedPage: number | null,
): Promise<AdminEventAttendanceReport | null> {
  const baseRows = attendanceRowsQuery(database, eventOccurrenceId, filters);
  const [occurrence, sessions, count] = await Promise.all([
    database
      .selectFrom("event_occurrence")
      .select(["id", "title", "timezone"])
      .where("id", "=", eventOccurrenceId)
      .executeTakeFirst(),
    database
      .selectFrom("event_session")
      .select(["id", "title", "startsAt", "endsAt"])
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .orderBy("position")
      .execute(),
    baseRows
      .select(sql<number>`count(*)::integer`.as("count"))
      .executeTakeFirstOrThrow(),
  ]);
  if (!occurrence) return null;

  const pages = Math.max(
    1,
    Math.ceil(count.count / ATTENDANCE_REPORT_PAGE_SIZE),
  );
  const page = requestedPage === null ? 1 : Math.min(requestedPage, pages);
  let selectedRowsQuery = baseRows
    .select([
      "participation.id as eventParticipationId",
      "session.id as eventSessionId",
      "session.title as sessionTitle",
      "session.startsAt as sessionStartsAt",
      "session.endsAt as sessionEndsAt",
      "participation.nameSnapshot as name",
      "participation.emailSnapshot as email",
      "participation.mode as participationMode",
      sql<
        AdminEventAttendanceReviewRow["state"]
      >`coalesce(attendance.state, 'not_recorded')`.as("state"),
      "attendance.source",
      "actor.name as recordedByName",
      "attendance.recordedAt",
      "attendance.updatedAt",
    ])
    .orderBy("participation.nameSnapshot")
    .orderBy("participation.emailSnapshot")
    .orderBy("session.position")
    .orderBy("participation.id")
    .orderBy("session.id");
  if (requestedPage !== null)
    selectedRowsQuery = selectedRowsQuery
      .limit(ATTENDANCE_REPORT_PAGE_SIZE)
      .offset((page - 1) * ATTENDANCE_REPORT_PAGE_SIZE);
  const selectedRows = await selectedRowsQuery.execute();

  let decisionsQuery = database
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
    .orderBy("decision.decisionAt");
  let intervalsQuery = database
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
    .orderBy("interval.joinedAt");
  if (selectedRows.length > 0) {
    decisionsQuery = decisionsQuery.where((expression) =>
      expression.or(
        selectedRows.map((row) =>
          expression.and([
            expression("decision.eventSessionId", "=", row.eventSessionId),
            expression(
              "decision.eventParticipationId",
              "=",
              row.eventParticipationId,
            ),
          ]),
        ),
      ),
    );
    intervalsQuery = intervalsQuery.where((expression) =>
      expression.or(
        selectedRows.map((row) =>
          expression.and([
            expression("interval.eventSessionId", "=", row.eventSessionId),
            expression(
              "interval.eventParticipationId",
              "=",
              row.eventParticipationId,
            ),
          ]),
        ),
      ),
    );
  }
  const [decisions, intervals] = selectedRows.length
    ? await Promise.all([decisionsQuery.execute(), intervalsQuery.execute()])
    : [[], []];

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
    rows: selectedRows.map((row) => {
      const key = evidenceKey(row.eventSessionId, row.eventParticipationId);
      return {
        ...row,
        sessionStartsAt: row.sessionStartsAt.toISOString(),
        sessionEndsAt: row.sessionEndsAt.toISOString(),
        recordedAt: row.recordedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt?.toISOString() ?? null,
        decisions: decisionsByScope.get(key) ?? [],
        intervals: intervalsByScope.get(key) ?? [],
      };
    }),
    pagination: {
      page,
      pages,
      total: count.count,
      pageSize: ATTENDANCE_REPORT_PAGE_SIZE,
    },
  };
}

export async function findAdminEventAttendanceReport(
  query: AdminEventAttendanceReportQuery,
): Promise<AdminEventAttendanceReport | null> {
  const { eventOccurrenceId, page, ...filters } = query;
  return await readAdminEventAttendanceReport(
    getDatabase(),
    eventOccurrenceId,
    filters,
    page,
  );
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
        filters,
        null,
      );
      if (!report) return null;
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_attendance.report_exported",
        subjectType: "event_occurrence",
        subjectId: eventOccurrenceId,
        metadata: {
          format: "csv",
          rowCount: report.pagination.total,
          searchApplied: filters.q.length > 0,
          sessionId: filters.sessionId,
          state: filters.state,
          evidence: filters.evidence,
        },
      });
      return report;
    });
}
