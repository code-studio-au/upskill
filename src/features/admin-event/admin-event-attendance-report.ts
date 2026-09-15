import type {
  AdminEventAttendanceFilter,
  AdminEventAttendanceReviewRow,
} from "./admin-event-operations.schema";

const staffSources = new Set(["administrator", "coordinator", "presenter"]);

export function hasEstimatedAttendanceEvidence(
  row: AdminEventAttendanceReviewRow,
): boolean {
  return row.intervals.some(
    (interval) =>
      interval.joinedSource === "provider_reconciliation" ||
      interval.leftSource === "provider_reconciliation" ||
      interval.leftSource === "room_end",
  );
}

export function filterAdminEventAttendanceRows(
  rows: ReadonlyArray<AdminEventAttendanceReviewRow>,
  filters: AdminEventAttendanceFilter,
): Array<AdminEventAttendanceReviewRow> {
  const query = filters.q.toLocaleLowerCase("en-AU");
  return rows.filter((row) => {
    const matchesEvidence =
      filters.evidence === "all" ||
      (filters.evidence === "automatic" && row.decisions.length > 0) ||
      (filters.evidence === "staff" &&
        row.source !== null &&
        staffSources.has(row.source)) ||
      (filters.evidence === "estimated" &&
        hasEstimatedAttendanceEvidence(row)) ||
      (filters.evidence === "none" &&
        row.decisions.length === 0 &&
        row.intervals.length === 0);
    return (
      (filters.sessionId === "all" ||
        row.eventSessionId === filters.sessionId) &&
      (filters.state === "all" || row.state === filters.state) &&
      matchesEvidence &&
      (!query ||
        row.name.toLocaleLowerCase("en-AU").includes(query) ||
        row.email.toLocaleLowerCase("en-AU").includes(query) ||
        row.sessionTitle.toLocaleLowerCase("en-AU").includes(query))
    );
  });
}
