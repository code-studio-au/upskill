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
import { encodeAdminEventAttendanceCsv } from "#/server/reporting/admin-event-attendance-csv";
import { sql, type Kysely, type Transaction } from "kysely";

const ATTENDANCE_REPORT_PAGE_SIZE = 25;
const ATTENDANCE_REPORT_EXPORT_BATCH_SIZE = 250;
const ATTENDANCE_REPORT_UI_EVIDENCE_LIMIT = 250;

type AttendanceRowCursor = Pick<
  AdminEventAttendanceReviewRow,
  "eventParticipationId" | "eventSessionId"
>;
type AttendanceDecisionCursor = { decisionAt: Date; id: string };
type AttendanceIntervalCursor = { joinedAt: Date; id: string };

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
    where interval_evidence."eventOccurrenceId" = session."eventOccurrenceId"
      and interval_evidence."eventSessionId" = session.id
      and interval_evidence."eventParticipationId" = participation.id
)`;
const estimatedEvidenceExists = sql<boolean>`exists (
  select 1
    from event_virtual_connection_interval estimated_evidence
    where estimated_evidence."eventOccurrenceId" = session."eventOccurrenceId"
      and estimated_evidence."eventSessionId" = session.id
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

function attendanceSelectedScopes(
  selectedRows: ReadonlyArray<AttendanceRowCursor>,
) {
  return sql<{
    eventSessionId: string;
    eventParticipationId: string;
  }>`(
    select
      scope.event_session_id as "eventSessionId",
      scope.event_participation_id as "eventParticipationId"
    from unnest(
      ${selectedRows.map((row) => row.eventSessionId)}::text[],
      ${selectedRows.map((row) => row.eventParticipationId)}::text[]
    ) as scope(event_session_id, event_participation_id)
  )`.as("selected_scope");
}

function attendanceDecisionsQuery(
  database: Kysely<Database> | Transaction<Database>,
  eventOccurrenceId: string,
  selectedRows: ReadonlyArray<AttendanceRowCursor>,
) {
  return database
    .selectFrom("event_virtual_attendance_decision as decision")
    .innerJoin(attendanceSelectedScopes(selectedRows), (join) =>
      join
        .onRef("selected_scope.eventSessionId", "=", "decision.eventSessionId")
        .onRef(
          "selected_scope.eventParticipationId",
          "=",
          "decision.eventParticipationId",
        ),
    )
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
    .where("decision.eventOccurrenceId", "=", eventOccurrenceId);
}

function attendanceIntervalsQuery(
  database: Kysely<Database> | Transaction<Database>,
  eventOccurrenceId: string,
  selectedRows: ReadonlyArray<AttendanceRowCursor>,
) {
  return database
    .selectFrom("event_virtual_connection_interval as interval")
    .innerJoin(attendanceSelectedScopes(selectedRows), (join) =>
      join
        .onRef("selected_scope.eventSessionId", "=", "interval.eventSessionId")
        .onRef(
          "selected_scope.eventParticipationId",
          "=",
          "interval.eventParticipationId",
        ),
    )
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
    .where("interval.eventOccurrenceId", "=", eventOccurrenceId);
}

async function readAdminEventAttendanceRows(
  database: Kysely<Database> | Transaction<Database>,
  eventOccurrenceId: string,
  filters: AdminEventAttendanceFilter,
  options:
    | { order: "display"; limit: number; offset: number }
    | {
        order: "export";
        limit: number;
        after: AttendanceRowCursor | null;
      },
): Promise<{
  rows: Array<AdminEventAttendanceReviewRow>;
  evidenceTruncated: boolean;
}> {
  const selectedRows = await attendanceRowsQuery(
    database,
    eventOccurrenceId,
    filters,
  )
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
      estimatedEvidenceExists.as("estimatedEvidencePresent"),
    ])
    .$if(options.order === "export" && options.after !== null, (query) => {
      const after = options.order === "export" ? options.after : null;
      if (!after) return query;
      return query.where((expression) =>
        expression.or([
          expression("participation.id", ">", after.eventParticipationId),
          expression.and([
            expression("participation.id", "=", after.eventParticipationId),
            expression("session.id", ">", after.eventSessionId),
          ]),
        ]),
      );
    })
    .$if(options.order === "display", (query) =>
      query
        .orderBy("participation.nameSnapshot")
        .orderBy("participation.emailSnapshot")
        .orderBy("session.position"),
    )
    .orderBy("participation.id")
    .orderBy("session.id")
    .limit(options.limit)
    .$if(options.order === "display", (query) =>
      query.offset(options.order === "display" ? options.offset : 0),
    )
    .execute();

  const decisionResults =
    selectedRows.length && options.order === "display"
      ? await attendanceDecisionsQuery(
          database,
          eventOccurrenceId,
          selectedRows,
        )
          .orderBy("decision.decisionAt")
          .orderBy("decision.id")
          .limit(ATTENDANCE_REPORT_UI_EVIDENCE_LIMIT + 1)
          .execute()
      : [];
  const decisions = decisionResults.slice(
    0,
    ATTENDANCE_REPORT_UI_EVIDENCE_LIMIT,
  );
  const intervalEvidenceLimit =
    ATTENDANCE_REPORT_UI_EVIDENCE_LIMIT - decisions.length;
  const intervalResults =
    selectedRows.length && options.order === "display"
      ? await attendanceIntervalsQuery(
          database,
          eventOccurrenceId,
          selectedRows,
        )
          .orderBy("interval.joinedAt")
          .orderBy("interval.id")
          .limit(intervalEvidenceLimit + 1)
          .execute()
      : [];
  const evidenceTruncated =
    decisionResults.length > ATTENDANCE_REPORT_UI_EVIDENCE_LIMIT ||
    intervalResults.length > intervalEvidenceLimit;
  const intervals = intervalResults.slice(0, intervalEvidenceLimit);

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
    evidenceTruncated,
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
  };
}

async function readAdminEventAttendanceReport(
  database: Kysely<Database> | Transaction<Database>,
  eventOccurrenceId: string,
  filters: AdminEventAttendanceFilter,
  requestedPage: number,
  pageSize = ATTENDANCE_REPORT_PAGE_SIZE,
  rowOrder: "display" | "export" = "display",
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

  const pages = Math.max(1, Math.ceil(count.count / pageSize));
  const page = Math.min(requestedPage, pages);
  const rowResult = await readAdminEventAttendanceRows(
    database,
    eventOccurrenceId,
    filters,
    rowOrder === "display"
      ? {
          order: "display",
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }
      : { order: "export", limit: pageSize, after: null },
  );

  return {
    occurrence,
    sessions: sessions.map((session) => ({
      ...session,
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
    })),
    rows: rowResult.rows,
    evidenceTruncated: rowResult.evidenceTruncated,
    pagination: {
      page,
      pages,
      total: count.count,
      pageSize,
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
): Promise<{
  occurrenceId: string;
  body: ReadableStream<Uint8Array>;
} | null> {
  const database = getDatabase();
  const asOf = new Date().toISOString();
  const transaction = await database
    .startTransaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute();
  let firstReport: AdminEventAttendanceReport | null;
  try {
    firstReport = await readAdminEventAttendanceReport(
      transaction,
      eventOccurrenceId,
      filters,
      1,
      ATTENDANCE_REPORT_EXPORT_BATCH_SIZE,
      "export",
    );
    if (!firstReport) {
      await transaction.rollback().execute();
      return null;
    }
    const exportRowCount = firstReport.pagination.total;
    await database.transaction().execute(async (auditTransaction) => {
      await recordDurableAuditEvent(auditTransaction, {
        actorUserId: administrator.id,
        action: "event_attendance.report_exported",
        subjectType: "event_occurrence",
        subjectId: eventOccurrenceId,
        metadata: {
          format: "csv",
          rowCount: exportRowCount,
          searchApplied: filters.q.length > 0,
          sessionId: filters.sessionId,
          state: filters.state,
          evidence: filters.evidence,
        },
      });
    });
  } catch (error) {
    await transaction.rollback().execute();
    throw error;
  }

  const occurrence = firstReport.occurrence;
  const pagination = firstReport.pagination;
  const encoder = new TextEncoder();
  let rows: Array<AdminEventAttendanceReviewRow> | null = firstReport.rows;
  let rowAfter: AttendanceRowCursor | null = null;
  let decisionAfter: AttendanceDecisionCursor | null = null;
  let intervalAfter: AttendanceIntervalCursor | null = null;
  let phase: "attendance" | "decisions" | "intervals" = "attendance";
  let includeHeader = true;
  let finalized = false;
  async function finalize(outcome: "commit" | "rollback") {
    if (finalized) return;
    finalized = true;
    if (outcome === "commit") await transaction.commit().execute();
    else await transaction.rollback().execute();
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          if (!rows) {
            const result = await readAdminEventAttendanceRows(
              transaction,
              eventOccurrenceId,
              filters,
              {
                order: "export",
                limit: ATTENDANCE_REPORT_EXPORT_BATCH_SIZE,
                after: rowAfter,
              },
            );
            rows = result.rows;
            decisionAfter = null;
            intervalAfter = null;
            phase = "attendance";
          }
          if (phase === "attendance") {
            if (rows.length === 0 && !includeHeader) {
              await finalize("commit");
              controller.close();
              return;
            }
            const chunk = encoder.encode(
              encodeAdminEventAttendanceCsv(
                {
                  occurrence,
                  sessions: [],
                  rows,
                  evidenceTruncated: false,
                  pagination,
                },
                filters,
                asOf,
                { includeHeader, applyFilters: false },
              ),
            );
            includeHeader = false;
            phase = "decisions";
            if (rows.length === 0) {
              await finalize("commit");
              controller.enqueue(chunk);
              controller.close();
              return;
            }
            controller.enqueue(chunk);
            return;
          }
          if (phase === "decisions") {
            const decisions = await attendanceDecisionsQuery(
              transaction,
              eventOccurrenceId,
              rows,
            )
              .$if(decisionAfter !== null, (query) => {
                const cursor = decisionAfter;
                if (!cursor) return query;
                return query.where((expression) =>
                  expression.or([
                    expression("decision.decisionAt", ">", cursor.decisionAt),
                    expression.and([
                      expression("decision.decisionAt", "=", cursor.decisionAt),
                      expression("decision.id", ">", cursor.id),
                    ]),
                  ]),
                );
              })
              .orderBy("decision.decisionAt")
              .orderBy("decision.id")
              .limit(ATTENDANCE_REPORT_EXPORT_BATCH_SIZE)
              .execute();
            if (decisions.length === 0) {
              phase = "intervals";
              continue;
            }
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
            const evidenceRows = rows.flatMap((row) => {
              const decisions = decisionsByScope.get(
                evidenceKey(row.eventSessionId, row.eventParticipationId),
              );
              return decisions ? [{ ...row, decisions, intervals: [] }] : [];
            });
            const last = decisions.at(-1);
            if (!last)
              throw new Error("Attendance decision export cursor is missing");
            decisionAfter = { decisionAt: last.decisionAt, id: last.id };
            if (decisions.length < ATTENDANCE_REPORT_EXPORT_BATCH_SIZE)
              phase = "intervals";
            controller.enqueue(
              encoder.encode(
                encodeAdminEventAttendanceCsv(
                  {
                    occurrence,
                    sessions: [],
                    rows: evidenceRows,
                    evidenceTruncated: false,
                    pagination,
                  },
                  filters,
                  asOf,
                  {
                    includeHeader: false,
                    includeAttendance: false,
                    applyFilters: false,
                  },
                ),
              ),
            );
            return;
          }
          const intervals = await attendanceIntervalsQuery(
            transaction,
            eventOccurrenceId,
            rows,
          )
            .$if(intervalAfter !== null, (query) => {
              const cursor = intervalAfter;
              if (!cursor) return query;
              return query.where((expression) =>
                expression.or([
                  expression("interval.joinedAt", ">", cursor.joinedAt),
                  expression.and([
                    expression("interval.joinedAt", "=", cursor.joinedAt),
                    expression("interval.id", ">", cursor.id),
                  ]),
                ]),
              );
            })
            .orderBy("interval.joinedAt")
            .orderBy("interval.id")
            .limit(ATTENDANCE_REPORT_EXPORT_BATCH_SIZE)
            .execute();
          if (intervals.length > 0) {
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
            const evidenceRows = rows.flatMap((row) => {
              const intervals = intervalsByScope.get(
                evidenceKey(row.eventSessionId, row.eventParticipationId),
              );
              return intervals ? [{ ...row, decisions: [], intervals }] : [];
            });
            const last = intervals.at(-1);
            if (!last)
              throw new Error("Attendance interval export cursor is missing");
            intervalAfter = { joinedAt: last.joinedAt, id: last.id };
            if (intervals.length < ATTENDANCE_REPORT_EXPORT_BATCH_SIZE) {
              const lastRow = rows.at(-1);
              if (!lastRow)
                throw new Error("Attendance export batch cursor is missing");
              rowAfter = {
                eventParticipationId: lastRow.eventParticipationId,
                eventSessionId: lastRow.eventSessionId,
              };
              rows = null;
            }
            controller.enqueue(
              encoder.encode(
                encodeAdminEventAttendanceCsv(
                  {
                    occurrence,
                    sessions: [],
                    rows: evidenceRows,
                    evidenceTruncated: false,
                    pagination,
                  },
                  filters,
                  asOf,
                  {
                    includeHeader: false,
                    includeAttendance: false,
                    applyFilters: false,
                  },
                ),
              ),
            );
            return;
          }
          const lastRow = rows.at(-1);
          if (!lastRow)
            throw new Error("Attendance export batch cursor is missing");
          rowAfter = {
            eventParticipationId: lastRow.eventParticipationId,
            eventSessionId: lastRow.eventSessionId,
          };
          rows = null;
        }
      } catch (error) {
        await finalize("rollback");
        controller.error(error);
      }
    },
    async cancel() {
      await finalize("rollback");
    },
  });
  return { occurrenceId: occurrence.id, body };
}
