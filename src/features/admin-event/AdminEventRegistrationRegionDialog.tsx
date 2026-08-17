import { useState } from "react";
import type { AdminEventOccurrenceOperations } from "./admin-event-operations.schema";
import { AppDialog } from "#/features/shared/AppDialog";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { Button, Group, Stack, Text } from "#/features/shared/mantine";
import { reassignAdminEventRegistrationRegion } from "#/server/functions/admin-event-operations";

type Registration = AdminEventOccurrenceOperations["registrations"][number];

export function AdminEventRegistrationRegionDialog({
  workspace,
  registration,
  processingId,
  action,
  onClose,
}: {
  workspace: AdminEventOccurrenceOperations;
  registration: Registration;
  processingId: string | null;
  action: (
    id: string,
    operation: () => Promise<{ status: string; reason?: string }>,
    successMessage?: string,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [destinationRegionId, setDestinationRegionId] = useState(
    registration.regionId ?? "",
  );
  const actionId = `reassign-region-${registration.id}`;
  const processing = processingId === actionId;

  return (
    <AppDialog
      title="Change registration region"
      closeDisabled={processing}
      onClose={onClose}
    >
      <Stack gap="md">
        <Text fw={600}>{registration.name}</Text>
        {registration.finalDecidedAt ? (
          <Text c="red.7">
            This registration has a final decision. Its decision and attendance
            evidence will be retained, while regional review data will be reset.
          </Text>
        ) : registration.coordinatorDecidedAt ? (
          <Text>
            The existing coordinator decision and priority will be reset for
            review in the new region.
          </Text>
        ) : null}
        <MantineNativeSelect
          label="Registration region"
          value={destinationRegionId}
          data={workspace.regions.map((region) => ({
            value: region.id,
            label: region.name,
          }))}
          onChange={(event) => {
            setDestinationRegionId(event.currentTarget.value);
          }}
        />
        <Group justify="flex-end">
          <Button variant="default" disabled={processing} onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={processing}
            disabled={
              !destinationRegionId ||
              destinationRegionId === registration.regionId
            }
            onClick={() => {
              void action(
                actionId,
                async () => {
                  const outcome = await reassignAdminEventRegistrationRegion({
                    data: {
                      eventOccurrenceId: workspace.occurrence.id,
                      registrationId: registration.id,
                      eventOccurrenceRegionId: destinationRegionId,
                      confirmFinalizedReassignment: Boolean(
                        registration.finalDecidedAt,
                      ),
                    },
                  });
                  if (outcome.status === "ready") onClose();
                  return outcome;
                },
                "Registration region changed.",
              );
            }}
          >
            {registration.finalDecidedAt
              ? "Confirm region change"
              : "Change region"}
          </Button>
        </Group>
      </Stack>
    </AppDialog>
  );
}
