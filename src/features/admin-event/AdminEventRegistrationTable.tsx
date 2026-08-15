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
import classes from "./AdminEventRegistrationTable.module.css";
import { Badge } from "#/features/shared/Badge";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { ResponsiveDataTable } from "#/features/shared/ResponsiveDataTable";
import { Button, Group, Text } from "#/features/shared/mantine";
import {
  decideAdminEventCoordinatorRegistration,
  decideAdminEventFinalRegistration,
} from "#/server/functions/admin-event-operations";

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

type Registration = AdminEventOccurrenceOperations["registrations"][number];
type RegistrationRow = Registration & { reviewLocked: boolean };
const registrationTableFeatures = tableFeatures({});
const registrationColumn = createColumnHelper<
  typeof registrationTableFeatures,
  RegistrationRow
>();

export function AdminEventRegistrationTable({
  workspace,
  priorities,
  processingId,
  mutationsAvailable,
  setPriorities,
  action,
}: {
  workspace: AdminEventOccurrenceOperations;
  priorities: Record<string, string>;
  processingId: string | null;
  mutationsAvailable: boolean;
  setPriorities: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  action: (
    id: string,
    operation: () => Promise<{ status: string; reason?: string }>,
  ) => Promise<void>;
}) {
  const data = useMemo(
    () =>
      workspace.registrations.map((registration) => ({
        ...registration,
        reviewLocked:
          workspace.regions.find(
            (candidate) => candidate.id === registration.regionId,
          )?.effectivelyLocked ?? false,
      })),
    [workspace.regions, workspace.registrations],
  );
  const columns = useMemo(
    () =>
      registrationColumn.columns([
        registrationColumn.accessor("name", {
          header: "Learner",
          cell: ({ row }) => (
            <div>
              <Text fw={600}>{row.original.name}</Text>
              <Text c="dimmed" size="sm">
                {row.original.email}
              </Text>
            </div>
          ),
        }),
        registrationColumn.accessor(
          (registration) => registration.regionName ?? "Direct / unregional",
          { id: "region", header: "Region" },
        ),
        registrationColumn.accessor("status", {
          header: "Status",
          cell: ({ row }) => (
            <Badge
              variant="light"
              color={row.original.status === "selected" ? "green" : "blue"}
            >
              {statusLabels[row.original.status]}
            </Badge>
          ),
        }),
        registrationColumn.display({
          id: "priority",
          header: "Priority",
          cell: ({ row }) => {
            const registration = row.original;
            return (
              <MantineTextInput
                aria-label={`Priority for ${registration.name}`}
                type="number"
                min={0}
                value={
                  priorities[registration.id] ??
                  String(registration.coordinatorPriority ?? "")
                }
                classNames={{ input: classes.priority }}
                disabled={!mutationsAvailable || registration.reviewLocked}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setPriorities((current) => ({
                    ...current,
                    [registration.id]: value,
                  }));
                }}
              />
            );
          },
        }),
        registrationColumn.display({
          id: "coordinatorReview",
          header: "Coordinator review",
          cell: ({ row }) => {
            const registration = row.original;
            return (
              <Group gap="xs" wrap="wrap">
                <Button
                  size="xs"
                  variant="light"
                  disabled={
                    !mutationsAvailable ||
                    !registration.reviewRoundId ||
                    registration.reviewLocked
                  }
                  loading={processingId === `approve-${registration.id}`}
                  onClick={() =>
                    void action(`approve-${registration.id}`, () =>
                      decideAdminEventCoordinatorRegistration({
                        data: {
                          eventOccurrenceId: workspace.occurrence.id,
                          registrationId: registration.id,
                          decision: "coordinator_approved",
                          priority: priorities[registration.id]
                            ? Number(priorities[registration.id])
                            : registration.coordinatorPriority,
                        },
                      }),
                    )
                  }
                >
                  Approve
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  disabled={
                    !mutationsAvailable ||
                    !registration.reviewRoundId ||
                    registration.reviewLocked
                  }
                  loading={processingId === `decline-${registration.id}`}
                  onClick={() =>
                    void action(`decline-${registration.id}`, () =>
                      decideAdminEventCoordinatorRegistration({
                        data: {
                          eventOccurrenceId: workspace.occurrence.id,
                          registrationId: registration.id,
                          decision: "coordinator_declined",
                          priority: null,
                        },
                      }),
                    )
                  }
                >
                  Decline
                </Button>
              </Group>
            );
          },
        }),
        registrationColumn.display({
          id: "finalDecision",
          header: "Final decision",
          cell: ({ row }) => {
            const registration = row.original;
            if (!mutationsAvailable) return null;
            return (
              <Group gap="xs" wrap="wrap">
                {(
                  [
                    "selected",
                    "waitlisted",
                    "not_selected",
                    "cancelled",
                  ] as const
                ).map((decision) => (
                  <Button
                    key={decision}
                    size="xs"
                    variant={decision === "selected" ? "filled" : "subtle"}
                    {...(decision === "cancelled"
                      ? { color: "red" as const }
                      : {})}
                    loading={processingId === `${decision}-${registration.id}`}
                    onClick={() =>
                      void action(`${decision}-${registration.id}`, () =>
                        decideAdminEventFinalRegistration({
                          data: {
                            eventOccurrenceId: workspace.occurrence.id,
                            registrationId: registration.id,
                            decision,
                          },
                        }),
                      )
                    }
                  >
                    {decision === "selected"
                      ? "Confirm"
                      : decision.replaceAll("_", " ")}
                  </Button>
                ))}
              </Group>
            );
          },
        }),
      ]),
    [
      action,
      mutationsAvailable,
      priorities,
      processingId,
      setPriorities,
      workspace.occurrence.id,
    ],
  );
  const table = useTable({
    features: registrationTableFeatures,
    columns,
    data,
  });

  return (
    <ResponsiveDataTable
      table={table}
      caption="Learner registrations, regional review and final decisions"
    />
  );
}
