import {
  createColumnHelper,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useMemo } from "react";
import { AdminDirectorySearch } from "#/features/admin/AdminDirectory";
import { Badge } from "#/features/shared/Badge";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { ResponsiveDataTable } from "#/features/shared/ResponsiveDataTable";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { Button, Group, Stack, Text, Title } from "#/features/shared/mantine";
import {
  adminEventAttendanceFilterSchema,
  type AdminEventAttendanceDecisionEvidence,
  type AdminEventAttendanceFilter,
  type AdminEventAttendanceReport,
  type AdminEventAttendanceReviewRow,
  type AdminEventAttendanceSource,
} from "./admin-event-operations.schema";
import { hasEstimatedAttendanceEvidence } from "./admin-event-attendance-report";
import classes from "./AdminEventAttendanceReview.module.css";

const attendanceLabels = {
  not_recorded: "Not recorded",
  checked_in: "Checked in",
  attended: "Attended",
  absent: "Absent",
} as const;
const sourceLabels: Record<AdminEventAttendanceSource, string> = {
  system: "System",
  self_check_in: "Self check-in",
  coordinator: "Coordinator",
  presenter: "Presenter",
  administrator: "Administrator",
};
const evidenceLabels: Record<AdminEventAttendanceFilter["evidence"], string> = {
  all: "All evidence",
  automatic: "Has automatic decision",
  staff: "Current staff correction",
  estimated: "Has estimated boundary",
  none: "No LiveKit evidence",
};
const outcomeLabels = {
  applied: "Applied",
  already_satisfied: "Already satisfied",
  preserved_manual: "Staff correction preserved",
} as const;
const attendanceTableFeatures = tableFeatures({ rowPaginationFeature });
const attendanceColumn = createColumnHelper<
  typeof attendanceTableFeatures,
  AdminEventAttendanceReviewRow
>();

function duration(seconds: number): string {
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
}

function automaticDecisionPolicy(
  decision: AdminEventAttendanceDecisionEvidence,
): string {
  if (decision.attendanceMode === "automatic_check_in")
    return "Automatic check-in";
  return decision.attendanceMinimumMinutes === null
    ? "Automatic duration"
    : `Automatic duration · ${String(decision.attendanceMinimumMinutes)}m minimum`;
}

function confirmAllEvidenceExport(recordCount: number): boolean {
  const recordLabel =
    recordCount === 1 ? "attendance record" : "attendance records";
  return globalThis.confirm(
    `Export all ${String(recordCount)} ${recordLabel}, including participant email addresses? This ignores the visible filters.`,
  );
}

function evidenceSummary(row: AdminEventAttendanceReviewRow): string {
  const displayedEvidenceTotal = row.decisions.length + row.intervals.length;
  const evidenceTotal = row.automaticEvidenceTotal + row.intervalEvidenceTotal;
  if (evidenceTotal === 0) return "No LiveKit evidence";
  if (displayedEvidenceTotal < evidenceTotal)
    return `Showing ${String(displayedEvidenceTotal)} of ${String(evidenceTotal)} LiveKit evidence records`;
  if (row.decisions.length)
    return `${String(row.decisions.length)} automatic decision${row.decisions.length === 1 ? "" : "s"}`;
  if (row.intervals.length)
    return `${String(row.intervals.length)} connection interval${row.intervals.length === 1 ? "" : "s"}`;
  return "No LiveKit evidence";
}

function EvidenceDetails({
  row,
  timezone,
}: {
  row: AdminEventAttendanceReviewRow;
  timezone: string;
}) {
  const displayedEvidenceTotal = row.decisions.length + row.intervals.length;
  const evidenceTotal = row.automaticEvidenceTotal + row.intervalEvidenceTotal;
  const evidenceTruncated = displayedEvidenceTotal < evidenceTotal;
  return (
    <Stack className={classes.evidence} gap="xs">
      <Text fw={700} size="sm">
        {evidenceSummary(row)}
      </Text>
      {evidenceTruncated ? (
        <Text c="dimmed" size="sm">
          This row&apos;s evidence is partially omitted from the preview. Export
          the filtered CSV to inspect its complete history.
        </Text>
      ) : null}
      {row.decisions.map((decision) => (
        <Text size="sm" key={decision.id}>
          {attendanceLabels[decision.attendanceState]} · generation{" "}
          {decision.roomGeneration} · {automaticDecisionPolicy(decision)} ·{" "}
          {duration(decision.qualifyingConnectedSeconds)} qualifying ·{" "}
          {outcomeLabels[decision.applicationOutcome]} ·{" "}
          {formatLocalDateTime(decision.decisionAt, { timeZone: timezone })} · v
          {decision.calculationVersion}
        </Text>
      ))}
      {row.intervals.map((interval) => (
        <Text size="sm" key={interval.id}>
          Generation {interval.roomGeneration} ·{" "}
          {formatLocalDateTime(interval.joinedAt, { timeZone: timezone })} to{" "}
          {interval.leftAt
            ? formatLocalDateTime(interval.leftAt, { timeZone: timezone })
            : "still open"}{" "}
          · {interval.joinedSource.replaceAll("_", " ")} /{" "}
          {interval.leftSource?.replaceAll("_", " ") ?? "open"}
        </Text>
      ))}
      <Text c="dimmed" size="xs">
        Connection evidence explains the automatic decision; it does not prove
        attention. Staff-authored attendance remains authoritative.
      </Text>
    </Stack>
  );
}

export function AdminEventAttendanceReview({
  report,
  filters,
  processingId,
  onFiltersChange,
  onPageChange,
  onRecordAttendance,
}: {
  report: AdminEventAttendanceReport;
  filters: AdminEventAttendanceFilter;
  processingId: string | null;
  onFiltersChange: (filters: AdminEventAttendanceFilter) => void;
  onPageChange: (page: number) => void;
  onRecordAttendance: (
    row: AdminEventAttendanceReviewRow,
    state: AdminEventAttendanceReviewRow["state"],
  ) => void;
}) {
  const rows = report.rows;
  const first = report.pagination.total
    ? (report.pagination.page - 1) * report.pagination.pageSize + 1
    : 0;
  const last = rows.length ? first + rows.length - 1 : 0;
  const exportQuery = new URLSearchParams(filters);
  const allEvidenceCount = report.pagination.allTotal;
  const hasActiveFilters =
    filters.q.length > 0 ||
    filters.sessionId !== "all" ||
    filters.state !== "all" ||
    filters.evidence !== "all";
  const columns = useMemo(
    () =>
      attendanceColumn.columns([
        attendanceColumn.accessor("name", {
          header: "Participant",
          cell: ({ row }) => (
            <Stack className={classes.identity} gap={4}>
              <Text fw={700}>{row.original.name}</Text>
              <Text c="dimmed" size="sm">
                {row.original.email}
              </Text>
              <Group gap="xs" wrap="wrap">
                {row.original.source ? (
                  <Badge color="gray" variant="light">
                    {sourceLabels[row.original.source]}
                  </Badge>
                ) : null}
                {hasEstimatedAttendanceEvidence(row.original) ? (
                  <Badge color="yellow" variant="light">
                    Estimated boundary
                  </Badge>
                ) : null}
              </Group>
            </Stack>
          ),
        }),
        attendanceColumn.accessor("sessionTitle", { header: "Session" }),
        attendanceColumn.display({
          id: "attendance",
          header: "Attendance",
          cell: ({ row }) => (
            <MantineNativeSelect
              aria-label={`Attendance for ${row.original.name} in ${row.original.sessionTitle}`}
              value={row.original.state}
              disabled={
                processingId ===
                `attendance-${row.original.eventSessionId}-${row.original.eventParticipationId}`
              }
              data={Object.entries(attendanceLabels).map(([value, label]) => ({
                value,
                label,
              }))}
              onChange={(event) => {
                onRecordAttendance(
                  row.original,
                  event.currentTarget
                    .value as AdminEventAttendanceReviewRow["state"],
                );
              }}
            />
          ),
        }),
        attendanceColumn.display({
          id: "evidence",
          header: "Evidence",
          cell: ({ row }) => evidenceSummary(row.original),
        }),
      ]),
    [onRecordAttendance, processingId],
  );
  const table = useTable({
    features: attendanceTableFeatures,
    columns,
    data: rows,
    getRowId: (row) => `${row.eventSessionId}:${row.eventParticipationId}`,
    manualPagination: true,
    rowCount: report.pagination.total,
  });
  return (
    <Stack gap="lg">
      <AdminDirectorySearch
        key={exportQuery.toString()}
        query={filters.q}
        label="Search attendance"
        placeholder="Participant, email or session"
        submitLabel="Apply filters"
        secondary={
          <div className={classes.filterGrid}>
            <MantineNativeSelect
              name="sessionId"
              label="Session"
              defaultValue={filters.sessionId}
              data={[
                { value: "all", label: "All sessions" },
                ...report.sessions.map(({ id, title }) => ({
                  value: id,
                  label: title,
                })),
              ]}
            />
            <MantineNativeSelect
              name="state"
              label="Attendance state"
              defaultValue={filters.state}
              data={[
                { value: "all", label: "All states" },
                ...Object.entries(attendanceLabels).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
            <MantineNativeSelect
              name="evidence"
              label="Evidence"
              defaultValue={filters.evidence}
              data={Object.entries(evidenceLabels).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </div>
        }
        onSubmit={(form) => {
          onFiltersChange(
            adminEventAttendanceFilterSchema.parse({
              q: form.get("q"),
              sessionId: form.get("sessionId"),
              state: form.get("state"),
              evidence: form.get("evidence"),
            }),
          );
        }}
      />
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Title order={2}>Attendance review</Title>
          <Text c="dimmed" size="sm">
            Showing {first}–{last} of {report.pagination.total} records
          </Text>
        </div>
        <Group gap="sm">
          <Button
            component="a"
            href={`/api/admin/events/instances/${encodeURIComponent(report.occurrence.id)}/attendance.csv?${exportQuery.toString()}`}
            onClick={(event) => {
              if (
                !hasActiveFilters &&
                !confirmAllEvidenceExport(allEvidenceCount)
              )
                event.preventDefault();
            }}
          >
            {hasActiveFilters
              ? "Export filtered CSV"
              : `Export all evidence (${String(allEvidenceCount)} ${allEvidenceCount === 1 ? "record" : "records"})`}
          </Button>
          {hasActiveFilters ? (
            <Button
              component="a"
              href={`/api/admin/events/instances/${encodeURIComponent(report.occurrence.id)}/attendance.csv?q=&sessionId=all&state=all&evidence=all`}
              variant="default"
              onClick={(event) => {
                if (!confirmAllEvidenceExport(allEvidenceCount))
                  event.preventDefault();
              }}
            >
              Export all evidence ({allEvidenceCount}{" "}
              {allEvidenceCount === 1 ? "record" : "records"})
            </Button>
          ) : null}
        </Group>
      </Group>
      {report.evidenceTruncated ? (
        <Text c="indigo.7" role="status" size="sm">
          This page shows a bounded evidence preview. Export the filtered CSV
          for the complete decision and connection history.
        </Text>
      ) : null}
      {rows.length ? (
        <ResponsiveDataTable
          table={table}
          caption="Attendance records and LiveKit evidence"
          expandedRowLabel={(row) =>
            `Toggle evidence for ${row.original.name} in ${row.original.sessionTitle}`
          }
          renderExpandedRow={(row) => (
            <EvidenceDetails
              row={row.original}
              timezone={report.occurrence.timezone}
            />
          )}
        />
      ) : (
        <Text c="dimmed">No attendance records match these filters.</Text>
      )}
      {report.pagination.pages > 1 ? (
        <Group justify="space-between" wrap="wrap">
          <Button
            type="button"
            variant="subtle"
            disabled={report.pagination.page === 1}
            onClick={() => {
              onPageChange(report.pagination.page - 1);
            }}
          >
            Previous page
          </Button>
          <Text size="sm">
            Page {report.pagination.page} of {report.pagination.pages}
          </Text>
          <Button
            type="button"
            variant="subtle"
            disabled={report.pagination.page === report.pagination.pages}
            onClick={() => {
              onPageChange(report.pagination.page + 1);
            }}
          >
            Next page
          </Button>
        </Group>
      ) : null}
    </Stack>
  );
}
