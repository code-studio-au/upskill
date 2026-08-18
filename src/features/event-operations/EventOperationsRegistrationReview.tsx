import { Badge } from "#/features/shared/Badge";
import { CompactActionSelect } from "#/features/shared/CompactActionSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { ResponsiveDataTable } from "#/features/shared/ResponsiveDataTable";
import { Alert, Button, Stack, Text } from "#/features/shared/mantine";
import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { lazy, Suspense, useMemo, useState } from "react";
import { decideEventCoordinatorRegistration } from "#/server/functions/event-operations";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
import type { EventOperationsWorkspace } from "./event-operations.schema";
import type { EventOperationsAction } from "./EventOperationsOverview";
import { registrationRegionDecisionLabel } from "#/features/admin-event/event-registration-region-decision";

const statusLabels: Record<
  EventOperationsWorkspace["registrations"][number]["status"],
  string
> = {
  submitted: "Submitted",
  coordinator_approved: "Candidate",
  coordinator_declined: "Not approved",
  selected: "Confirmed",
  waitlisted: "Waitlisted",
  not_selected: "Not selected",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
};
type Registration = EventOperationsWorkspace["registrations"][number];
type RegistrationRow = Registration & { reviewLocked: boolean };
const registrationTableFeatures = tableFeatures({});
const registrationColumn = createColumnHelper<
  typeof registrationTableFeatures,
  RegistrationRow
>();

const AdminEventRegistrationRegionDialog = lazy(async () => {
  const module =
    await import("#/features/admin-event/AdminEventRegistrationRegionDialog");
  return { default: module.AdminEventRegistrationRegionDialog };
});

export function EventOperationsRegistrationReview({
  workspace,
  priorities,
  processingId,
  setPriorities,
  action,
}: {
  workspace: EventOperationsWorkspace;
  priorities: Record<string, string>;
  processingId: string | null;
  setPriorities: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  action: EventOperationsAction;
}) {
  const [regionRegistration, setRegionRegistration] =
    useState<Registration | null>(null);
  const administrator = workspace.access.roles.includes("administrator");
  const data = useMemo(
    () =>
      workspace.registrations.map((registration) => ({
        ...registration,
        reviewLocked:
          workspace.regions.find(
            (candidate) => candidate.id === registration.regionId,
          )?.effectivelyLocked ?? true,
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
              <Text fw={700}>{row.original.name}</Text>
              <Text c="dimmed" size="sm">
                {row.original.email}
              </Text>
            </div>
          ),
        }),
        registrationColumn.accessor(
          (registration) => registration.regionName ?? "No region",
          {
            id: "region",
            header: "Region",
            cell: ({ row }) => {
              const registration = row.original;
              return (
                <Stack gap={4}>
                  <Text>{registration.regionName ?? "No region"}</Text>
                  {registration.regionDecision ||
                  registration.regionMismatch ? (
                    <Badge
                      color={registration.regionDecision ? "green" : "orange"}
                      variant="light"
                    >
                      {registration.regionDecision
                        ? registrationRegionDecisionLabel(
                            registration.regionDecision,
                          )
                        : `Current profile: ${registration.profileRegionName ?? "No region"} · administrator review`}
                    </Badge>
                  ) : null}
                  {administrator &&
                  (registration.regionMismatch ||
                    registration.regionDecision) ? (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      disabled={
                        registration.status === "withdrawn" ||
                        registration.status === "cancelled"
                      }
                      onClick={() => {
                        setRegionRegistration(registration);
                      }}
                    >
                      Review region
                    </Button>
                  ) : null}
                </Stack>
              );
            },
          },
        ),
        registrationColumn.accessor("status", {
          header: "Status",
          cell: ({ row }) => (
            <Badge variant="light">{statusLabels[row.original.status]}</Badge>
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
                disabled={registration.reviewLocked}
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
          id: "review",
          header: "Review",
          cell: ({ row }) => {
            const registration = row.original;
            return (
              <CompactActionSelect
                label="Review"
                ariaLabel={`Review registration for ${registration.name}`}
                disabled={
                  !registration.reviewRoundId || registration.reviewLocked
                }
                loading={
                  processingId === `approve-${registration.id}` ||
                  processingId === `decline-${registration.id}`
                }
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
                    decideEventCoordinatorRegistration({
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
      ]),
    [
      action,
      administrator,
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
  if (!workspace.registrations.length)
    return (
      <Alert title="No assigned registrations">
        Registrations for your assigned regions will appear here.
      </Alert>
    );
  return (
    <>
      <ResponsiveDataTable
        table={table}
        caption="Learner registrations assigned for coordinator review"
      />
      {regionRegistration ? (
        <Suspense fallback={<LoadingSpinner label="Loading region review" />}>
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
