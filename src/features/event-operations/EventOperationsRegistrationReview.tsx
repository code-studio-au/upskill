import { Badge } from "#/features/shared/Badge";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
} from "#/features/shared/mantine";
import { decideEventCoordinatorRegistration } from "#/server/functions/event-operations";
import classes from "./EventOperations.module.css";
import type { EventOperationsWorkspace } from "./event-operations.schema";
import type { EventOperationsAction } from "./EventOperationsOverview";

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
  if (!workspace.registrations.length)
    return (
      <Alert title="No assigned registrations">
        Registrations for your assigned regions will appear here.
      </Alert>
    );
  return (
    <div className={classes.registrationList}>
      {workspace.registrations.map((registration) => {
        const region = workspace.regions.find(
          (candidate) => candidate.id === registration.regionId,
        );
        const reviewLocked = region?.effectivelyLocked ?? true;
        return (
          <Paper withBorder radius="lg" p="md" key={registration.id}>
            <Stack gap="md">
              <Group justify="space-between" align="start" wrap="wrap">
                <div>
                  <Text fw={700}>{registration.name}</Text>
                  <Text c="dimmed" size="sm">
                    {registration.email}
                  </Text>
                  <Text size="sm" mt={4}>
                    {registration.regionName ?? "No region"}
                  </Text>
                </div>
                <Badge variant="light">
                  {statusLabels[registration.status]}
                </Badge>
              </Group>
              <MantineTextInput
                label="Priority"
                type="number"
                min={0}
                value={
                  priorities[registration.id] ??
                  String(registration.coordinatorPriority ?? "")
                }
                disabled={reviewLocked}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setPriorities((current) => ({
                    ...current,
                    [registration.id]: value,
                  }));
                }}
              />
              <Group gap="sm">
                <Button
                  size="sm"
                  variant="light"
                  disabled={!registration.reviewRoundId || reviewLocked}
                  loading={processingId === `approve-${registration.id}`}
                  onClick={() =>
                    void action(`approve-${registration.id}`, () =>
                      decideEventCoordinatorRegistration({
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
                  size="sm"
                  variant="subtle"
                  color="red"
                  disabled={!registration.reviewRoundId || reviewLocked}
                  loading={processingId === `decline-${registration.id}`}
                  onClick={() =>
                    void action(`decline-${registration.id}`, () =>
                      decideEventCoordinatorRegistration({
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
            </Stack>
          </Paper>
        );
      })}
    </div>
  );
}
