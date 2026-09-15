import { useMemo } from "react";
import { AdminDirectorySearch } from "#/features/admin/AdminDirectory";
import { Badge } from "#/features/shared/Badge";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { Button, Group, Stack, Text, Title } from "#/features/shared/mantine";
import {
  adminEventAttendanceFilterSchema,
  type AdminEventAttendanceFilter,
  type AdminEventAttendanceReport,
  type AdminEventAttendanceReviewRow,
  type AdminEventAttendanceSource,
} from "./admin-event-operations.schema";
import {
  filterAdminEventAttendanceRows,
  hasEstimatedAttendanceEvidence,
} from "./admin-event-attendance-report";
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

function duration(seconds: number): string {
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
}

function Evidence({
  row,
  timezone,
}: {
  row: AdminEventAttendanceReviewRow;
  timezone: string;
}) {
  return (
    <details className={classes.evidence}>
      <summary>
        {row.decisions.length
          ? `${String(row.decisions.length)} automatic decision${row.decisions.length === 1 ? "" : "s"}`
          : row.intervals.length
            ? `${String(row.intervals.length)} connection interval${row.intervals.length === 1 ? "" : "s"}`
            : "No LiveKit evidence"}
      </summary>
      {row.decisions.map((decision) => (
        <Text size="sm" key={decision.id}>
          {attendanceLabels[decision.attendanceState]} · generation{" "}
          {decision.roomGeneration} ·{" "}
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
    </details>
  );
}

export function AdminEventAttendanceReview({
  report,
  filters,
  processingId,
  onFiltersChange,
  onRecordAttendance,
}: {
  report: AdminEventAttendanceReport;
  filters: AdminEventAttendanceFilter;
  processingId: string | null;
  onFiltersChange: (filters: AdminEventAttendanceFilter) => void;
  onRecordAttendance: (
    row: AdminEventAttendanceReviewRow,
    state: AdminEventAttendanceReviewRow["state"],
  ) => void;
}) {
  const rows = useMemo(
    () => filterAdminEventAttendanceRows(report.rows, filters),
    [filters, report.rows],
  );
  const exportQuery = new URLSearchParams(filters);
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
            {rows.length} matching participant-session records
          </Text>
        </div>
        <Group gap="sm">
          <Button
            component="a"
            href={`/api/admin/events/instances/${encodeURIComponent(report.occurrence.id)}/attendance.csv?${exportQuery.toString()}`}
            variant="light"
          >
            Export filtered CSV
          </Button>
          <Button
            component="a"
            href={`/api/admin/events/instances/${encodeURIComponent(report.occurrence.id)}/attendance.csv?q=&sessionId=all&state=all&evidence=all`}
            variant="subtle"
          >
            Export all evidence
          </Button>
        </Group>
      </Group>
      {rows.length ? (
        <div className={classes.rows}>
          {rows.map((row) => (
            <article
              className={classes.row}
              key={`${row.eventSessionId}:${row.eventParticipationId}`}
            >
              <div className={classes.identity}>
                <Text fw={700}>{row.name}</Text>
                <Text c="dimmed" size="sm">
                  {row.email} · {row.sessionTitle}
                </Text>
                <Group gap="xs" wrap="wrap">
                  {row.source ? (
                    <Badge color="gray" variant="light">
                      {sourceLabels[row.source]}
                    </Badge>
                  ) : null}
                  {hasEstimatedAttendanceEvidence(row) ? (
                    <Badge color="yellow" variant="light">
                      Estimated boundary
                    </Badge>
                  ) : null}
                </Group>
              </div>
              <MantineNativeSelect
                aria-label={`Attendance for ${row.name} in ${row.sessionTitle}`}
                value={row.state}
                disabled={
                  processingId ===
                  `attendance-${row.eventSessionId}-${row.eventParticipationId}`
                }
                data={Object.entries(attendanceLabels).map(
                  ([value, label]) => ({ value, label }),
                )}
                onChange={(event) => {
                  onRecordAttendance(
                    row,
                    event.currentTarget
                      .value as AdminEventAttendanceReviewRow["state"],
                  );
                }}
              />
              <Evidence row={row} timezone={report.occurrence.timezone} />
            </article>
          ))}
        </div>
      ) : (
        <Text c="dimmed">No attendance records match these filters.</Text>
      )}
    </Stack>
  );
}
