import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { lazy, Suspense, useMemo, useState } from "react";
import type {
  AdminEventOccurrenceOperations,
  EventRegistrationStatus,
} from "./admin-event-operations.schema";
import classes from "./AdminEventRegistrationTable.module.css";
import { CompactActionSelect } from "#/features/shared/CompactActionSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { ResponsiveDataTable } from "#/features/shared/ResponsiveDataTable";
import { Badge } from "#/features/shared/Badge";
import { Button, Group, Stack, Text } from "#/features/shared/mantine";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
import {
  decideAdminEventCoordinatorRegistration,
  decideAdminEventFinalRegistration,
  resendAdminEventAccountSetup,
} from "#/server/functions/admin-event-operations";
import { registrationRegionDecisionLabel } from "./event-registration-region-decision";

const AdminEventRegistrationRegionDialog = lazy(async () => {
  const module = await import("./AdminEventRegistrationRegionDialog");
  return { default: module.AdminEventRegistrationRegionDialog };
});

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
    successMessage?: string,
  ) => Promise<void>;
}) {
  const [regionRegistration, setRegionRegistration] =
    useState<Registration | null>(null);
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
            <Stack gap={4}>
              <Text fw={600}>{row.original.name}</Text>
              <Text c="dimmed" size="sm">
                {row.original.email}
              </Text>
              {row.original.accountState === "provisional" ? (
                <Group gap="xs" wrap="wrap">
                  <Badge color="orange" variant="light">
                    Setup pending
                  </Badge>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    loading={processingId === `resend-setup-${row.original.id}`}
                    onClick={() => {
                      void action(
                        `resend-setup-${row.original.id}`,
                        () =>
                          resendAdminEventAccountSetup({
                            data: {
                              eventOccurrenceId: workspace.occurrence.id,
                              userId: row.original.userId,
                            },
                          }),
                        "Account setup email queued.",
                      );
                    }}
                  >
                    Resend setup email
                  </Button>
                </Group>
              ) : null}
            </Stack>
          ),
        }),
        registrationColumn.display({
          id: "region",
          header: "Region",
          cell: ({ row }) => {
            const registration = row.original;
            return (
              <Stack gap={4}>
                <Text>{registration.regionName ?? "Direct / unregional"}</Text>
                {registration.regionDecision || registration.regionMismatch ? (
                  <Badge
                    color={registration.regionDecision ? "green" : "orange"}
                    variant="light"
                  >
                    {registration.regionDecision
                      ? registrationRegionDecisionLabel(
                          registration.regionDecision,
                        )
                      : `Current profile: ${registration.profileRegionName ?? "No region"} · review`}
                  </Badge>
                ) : null}
                {workspace.regions.length > 1 ||
                registration.regionMismatch ||
                registration.regionDecision ? (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    disabled={
                      !mutationsAvailable ||
                      registration.status === "withdrawn" ||
                      registration.status === "cancelled"
                    }
                    onClick={() => {
                      setRegionRegistration(registration);
                    }}
                  >
                    {registration.regionMismatch || registration.regionDecision
                      ? "Review region"
                      : "Change region"}
                  </Button>
                ) : null}
              </Stack>
            );
          },
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
            const disabled =
              !mutationsAvailable ||
              !registration.reviewRoundId ||
              registration.reviewLocked;
            return (
              <CompactActionSelect
                label="Review"
                ariaLabel={`Coordinator review for ${registration.name}`}
                disabled={disabled}
                loading={Boolean(processingId?.endsWith(registration.id))}
                items={[
                  { value: "coordinator_approved", label: "Approve" },
                  {
                    value: "coordinator_declined",
                    label: "Decline",
                  },
                ]}
                onSelect={(decision) => {
                  const actionId =
                    decision === "coordinator_approved" ? "approve" : "decline";
                  void action(`${actionId}-${registration.id}`, () =>
                    decideAdminEventCoordinatorRegistration({
                      data: {
                        eventOccurrenceId: workspace.occurrence.id,
                        registrationId: registration.id,
                        decision,
                        priority:
                          decision === "coordinator_approved"
                            ? priorities[registration.id]
                              ? Number(priorities[registration.id])
                              : registration.coordinatorPriority
                            : null,
                      },
                    }),
                  );
                }}
              />
            );
          },
        }),
        registrationColumn.display({
          id: "finalDecision",
          header: "Final decision",
          cell: ({ row }) => {
            const registration = row.original;
            const pendingDecision =
              (registration.status === "submitted" &&
                !registration.reviewRoundId) ||
              (registration.status === "coordinator_approved" &&
                Boolean(registration.reviewRoundId) &&
                registration.reviewLocked);
            const canDecide =
              mutationsAvailable &&
              !registration.finalDecisionLocked &&
              (pendingDecision || Boolean(registration.finalDecidedAt));
            if (!canDecide)
              return registration.finalDecidedAt ||
                registration.status === "coordinator_declined"
                ? statusLabels[registration.status]
                : "Pending";
            return (
              <CompactActionSelect
                label={registration.finalDecidedAt ? "Change" : "Decide"}
                ariaLabel={`Final decision for ${registration.name}`}
                loading={Boolean(processingId?.endsWith(registration.id))}
                items={[
                  { value: "selected", label: "Confirm place" },
                  { value: "waitlisted", label: "Move to waitlist" },
                  { value: "not_selected", label: "Not selected" },
                  { value: "cancelled", label: "Cancel" },
                ]}
                onSelect={(decision) => {
                  void action(`${decision}-${registration.id}`, () =>
                    decideAdminEventFinalRegistration({
                      data: {
                        eventOccurrenceId: workspace.occurrence.id,
                        registrationId: registration.id,
                        decision,
                      },
                    }),
                  );
                }}
              />
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
      workspace.regions,
    ],
  );
  const table = useTable({
    features: registrationTableFeatures,
    columns,
    data,
  });

  return (
    <>
      <ResponsiveDataTable
        table={table}
        caption="Learner registrations, regional review and final decisions"
      />
      {regionRegistration ? (
        <Suspense fallback={<LoadingSpinner label="Loading region change" />}>
          <AdminEventRegistrationRegionDialog
            workspace={workspace}
            registration={regionRegistration}
            processingId={processingId}
            action={action}
            onClose={() => {
              setRegionRegistration(null);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
