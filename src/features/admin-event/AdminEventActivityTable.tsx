import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useMemo } from "react";
import type {
  AdminEventOccurrenceOperations,
  EventRegistrationStatus,
} from "./admin-event-operations.schema";
import { ResponsiveDataTable } from "#/features/shared/ResponsiveDataTable";
import { formatLocalDateTime } from "#/features/shared/local-date";

const statusLabels: Record<EventRegistrationStatus, string> = {
  submitted: "Submitted",
  coordinator_approved: "Candidate",
  coordinator_declined: "Not approved",
  selected: "Confirmed",
  waitlisted: "Waitlisted",
  not_selected: "Not selected",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
};
type ActivityRow = AdminEventOccurrenceOperations["activity"][number];
const activityTableFeatures = tableFeatures({});
const activityColumn = createColumnHelper<
  typeof activityTableFeatures,
  ActivityRow
>();

export function AdminEventActivityTable({
  activity,
  timezone,
}: {
  activity: AdminEventOccurrenceOperations["activity"];
  timezone: string;
}) {
  const columns = useMemo(
    () =>
      activityColumn.columns([
        activityColumn.accessor("occurredAt", {
          header: "When",
          cell: ({ row }) =>
            formatLocalDateTime(row.original.occurredAt, {
              timeZone: timezone,
            }),
        }),
        activityColumn.accessor("learnerName", { header: "Learner" }),
        activityColumn.display({
          id: "transition",
          header: "Transition",
          cell: ({ row }) => {
            const entry = row.original;
            const state = `${entry.fromStatus ? `${statusLabels[entry.fromStatus]} → ` : ""}${statusLabels[entry.toStatus]}${entry.priority === null ? "" : ` · priority ${String(entry.priority)}`}`;
            const region =
              entry.fromRegionName && entry.toRegionName
                ? ` · ${entry.fromRegionName} → ${entry.toRegionName}`
                : "";
            return `${state}${region}`;
          },
        }),
        activityColumn.accessor("source", { header: "Source" }),
        activityColumn.accessor("actorName", {
          header: "Actor",
          cell: ({ row }) => row.original.actorName ?? "System",
        }),
      ]),
    [timezone],
  );
  const table = useTable({
    features: activityTableFeatures,
    columns,
    data: activity,
  });

  return (
    <ResponsiveDataTable
      table={table}
      caption="Event registration decision activity"
    />
  );
}
