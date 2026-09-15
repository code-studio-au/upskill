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

type AttendanceRowCursor = Pick<
  AdminEventAttendanceReviewRow,
  "eventParticipationId" | "eventSessionId"
>;

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
): Promise<Array<AdminEventAttendanceReviewRow>> {
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

  const selectedScopes = sql<{
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
  const decisionsQuery = database
    .selectFrom("event_virtual_attendance_decision as decision")
    .innerJoin(selectedScopes, (join) =>
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
    .where("decision.eventOccurrenceId", "=", eventOccurrenceId)
    .orderBy("decision.decisionAt");
  const intervalsQuery = database
    .selectFrom("event_virtual_connection_interval as interval")
    .innerJoin(selectedScopes, (join) =>
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
    .where("interval.eventOccurrenceId", "=", eventOccurrenceId)
    .orderBy("interval.joinedAt");
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

  return selectedRows.map((row) => {
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
  });
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
  const rows = await readAdminEventAttendanceRows(
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
    rows,
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
    await recordDurableAuditEvent(transaction, {
      actorUserId: administrator.id,
      action: "event_attendance.report_exported",
      subjectType: "event_occurrence",
      subjectId: eventOccurrenceId,
      metadata: {
        format: "csv",
        rowCount: firstReport.pagination.total,
        searchApplied: filters.q.length > 0,
        sessionId: filters.sessionId,
        state: filters.state,
        evidence: filters.evidence,
      },
    });
  } catch (error) {
    await transaction.rollback().execute();
    throw error;
  }

  const occurrence = firstReport.occurrence;
  const pagination = firstReport.pagination;
  const encoder = new TextEncoder();
  let pendingRows: Array<AdminEventAttendanceReviewRow> | null =
    firstReport.rows;
  let after: AttendanceRowCursor | null = null;
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
        const rows =
          pendingRows ??
          (await readAdminEventAttendanceRows(
            transaction,
            eventOccurrenceId,
            filters,
            {
              order: "export",
              limit: ATTENDANCE_REPORT_EXPORT_BATCH_SIZE,
              after,
            },
          ));
        pendingRows = null;
        if (!includeHeader && rows.length === 0) {
          await finalize("commit");
          controller.close();
          return;
        }
        const chunk = encoder.encode(
          encodeAdminEventAttendanceCsv(
            { occurrence, sessions: [], rows, pagination },
            filters,
            asOf,
            includeHeader,
          ),
        );
        const complete = rows.length < ATTENDANCE_REPORT_EXPORT_BATCH_SIZE;
        if (complete) await finalize("commit");
        controller.enqueue(chunk);
        if (complete) {
          controller.close();
          return;
        }
        const last = rows.at(-1);
        if (!last) throw new Error("Attendance export batch cursor is missing");
        after = {
          eventParticipationId: last.eventParticipationId,
          eventSessionId: last.eventSessionId,
        };
        includeHeader = false;
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
