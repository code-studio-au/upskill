import {
  createColumnHelper,
  rowPaginationFeature,
  tableFeatures,
  useTable,
  type PaginationState,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Badge } from "#/features/shared/Badge";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { RemovableFilterChip } from "#/features/shared/RemovableFilterChip";
import { ResponsiveDataTable } from "#/features/shared/ResponsiveDataTable";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import {
  eventProgressFilterSchema,
  type EventParticipantProgress,
  type EventParticipantProgressState,
  type EventProgressFilter,
  type EventOperationsWorkspace,
  type EventSectionProgressState,
} from "./event-operations.schema";
import { indexEventAttendanceByParticipant } from "./participant-attendance";
import { ParticipantAttendanceSummary } from "./ParticipantAttendanceSummary";
import { filterEventParticipantProgress } from "./event-progress";
import classes from "./EventOperations.module.css";

const participantStateLabels: Record<EventParticipantProgressState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  up_to_date: "Up to date",
  completed: "Completed",
};
const sectionStateLabels: Record<EventSectionProgressState, string> = {
  locked: "Locked",
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
};
const progressTableFeatures = tableFeatures({ rowPaginationFeature });
const progressColumn = createColumnHelper<
  typeof progressTableFeatures,
  EventParticipantProgress
>();

export function EventOperationsProgress({
  workspace,
  filters,
  onFiltersChange,
}: {
  workspace: EventOperationsWorkspace;
  filters: EventProgressFilter;
  onFiltersChange: (filters: EventProgressFilter) => void;
}) {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });
  const data = useMemo(
    () =>
      filterEventParticipantProgress(workspace.participantProgress, filters),
    [filters, workspace.participantProgress],
  );
  const sectionDefinitions = useMemo(
    () =>
      workspace.participantProgress[0]?.sections.map((section) => ({
        id: section.id,
        title: section.title,
      })) ?? [],
    [workspace.participantProgress],
  );
  const attendanceByParticipant = useMemo(
    () => indexEventAttendanceByParticipant(workspace.sessions),
    [workspace.sessions],
  );
  const columns = useMemo(
    () =>
      progressColumn.columns([
        progressColumn.accessor("name", {
          header: "Participant",
          cell: ({ row }) => (
            <div>
              <Text fw={700}>{row.original.name}</Text>
              <Text c="dimmed" size="sm">
                {row.original.email}
              </Text>
            </div>
          ),
        }),
        progressColumn.accessor(
          (participant) => participant.regionName ?? "No assigned region",
          { id: "region", header: "Region" },
        ),
        progressColumn.accessor("state", {
          header: "Overall",
          cell: ({ row }) => (
            <Badge
              variant="light"
              color={
                row.original.state === "completed"
                  ? "green"
                  : row.original.state === "up_to_date"
                    ? "teal"
                    : "blue"
              }
            >
              {participantStateLabels[row.original.state]}
            </Badge>
          ),
        }),
        progressColumn.accessor("completedAvailableItems", {
          header: "Available progress",
          cell: ({ row }) => (
            <Text size="sm">
              {row.original.completedAvailableItems} of{" "}
              {row.original.availableItems}
              {row.original.availableItems < row.original.totalItems
                ? ` (${String(row.original.totalItems - row.original.availableItems)} locked)`
                : ""}
            </Text>
          ),
        }),
        progressColumn.display({
          id: "attendance",
          header: "Attendance",
          cell: ({ row }) => (
            <ParticipantAttendanceSummary
              attendance={
                attendanceByParticipant.get(
                  row.original.eventParticipationId,
                ) ?? []
              }
            />
          ),
        }),
        ...sectionDefinitions.map((definition) =>
          progressColumn.display({
            id: `section-${definition.id}`,
            header: definition.title,
            cell: ({ row }) => {
              const section = row.original.sections.find(
                (candidate) => candidate.id === definition.id,
              );
              if (!section) return null;
              return (
                <details className={classes.progressDetails}>
                  <summary>
                    <Badge
                      variant="light"
                      color={
                        section.state === "completed"
                          ? "green"
                          : section.state === "locked"
                            ? "gray"
                            : "blue"
                      }
                    >
                      {sectionStateLabels[section.state]}
                    </Badge>
                    <Text component="span" size="xs" c="dimmed">
                      {section.completedItems}/{section.totalItems}
                    </Text>
                  </summary>
                  <ul className={classes.progressItemList}>
                    {section.items.map((item) => (
                      <li key={item.id}>
                        <Text size="xs">
                          {item.title}:{" "}
                          {item.state === "completed" ? "Done" : "Missing"}
                          {!item.required ? " (optional)" : ""}
                        </Text>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            },
          }),
        ),
      ]),
    [attendanceByParticipant, sectionDefinitions],
  );
  const table = useTable({
    features: progressTableFeatures,
    columns,
    data,
    state: { pagination },
    onPaginationChange: setPagination,
  });
  const filteredExport = new URLSearchParams({
    q: filters.q,
    state: filters.state,
  });

  return (
    <Stack gap="lg">
      <Paper withBorder radius="lg" p="md">
        <form
          key={`${filters.q}:${filters.state}`}
          className={classes.progressFilters}
          action={(form) => {
            const next = eventProgressFilterSchema.parse({
              q: form.get("q"),
              state: form.get("state"),
            });
            setPagination((current) => ({ ...current, pageIndex: 0 }));
            onFiltersChange(next);
          }}
        >
          <MantineTextInput
            name="q"
            label="Search participants"
            defaultValue={filters.q}
            placeholder="Name, email or region"
            maxLength={100}
          />
          <MantineNativeSelect
            name="state"
            label="Progress state"
            defaultValue={filters.state}
            data={[
              { value: "all", label: "All states" },
              { value: "not_started", label: "Not started" },
              { value: "in_progress", label: "In progress" },
              { value: "up_to_date", label: "Up to date" },
              { value: "completed", label: "Completed" },
            ]}
          />
          <Button type="submit">Apply filters</Button>
        </form>
      </Paper>

      {filters.q || filters.state !== "all" ? (
        <Stack gap="xs">
          <Text size="sm" fw={700}>
            Current filters
          </Text>
          <Group gap="xs">
            {filters.q ? (
              <RemovableFilterChip
                label="Search"
                value={filters.q}
                onRemove={() => {
                  onFiltersChange({ ...filters, q: "" });
                }}
              />
            ) : null}
            {filters.state !== "all" ? (
              <RemovableFilterChip
                label="State"
                value={participantStateLabels[filters.state]}
                onRemove={() => {
                  onFiltersChange({ ...filters, state: "all" });
                }}
              />
            ) : null}
          </Group>
        </Stack>
      ) : null}

      <Group justify="space-between" align="end" wrap="wrap">
        <Title order={2}>Participant progress</Title>
        <Group gap="sm">
          <Button
            component="a"
            href={`/api/event-operations/${encodeURIComponent(workspace.occurrence.id)}/progress.csv?${filteredExport.toString()}`}
            variant="light"
          >
            Export filtered CSV
          </Button>
          <Button
            component="a"
            href={`/api/event-operations/${encodeURIComponent(workspace.occurrence.id)}/progress.csv?q=&state=all`}
            variant="subtle"
          >
            Export all in scope
          </Button>
        </Group>
      </Group>

      {data.length ? (
        <>
          <ResponsiveDataTable
            table={table}
            caption="Authorised event participant and section progress"
          />
          {table.getPageCount() > 1 ? (
            <Group justify="space-between">
              <Button
                variant="light"
                disabled={!table.getCanPreviousPage()}
                onClick={() => {
                  table.previousPage();
                }}
              >
                Previous
              </Button>
              <Text size="sm">
                Page {pagination.pageIndex + 1} of {table.getPageCount()}
              </Text>
              <Button
                variant="light"
                disabled={!table.getCanNextPage()}
                onClick={() => {
                  table.nextPage();
                }}
              >
                Next
              </Button>
            </Group>
          ) : null}
        </>
      ) : (
        <Alert title="No participant progress matches">
          Clear or change the filters to see another authorised participant.
        </Alert>
      )}
    </Stack>
  );
}
