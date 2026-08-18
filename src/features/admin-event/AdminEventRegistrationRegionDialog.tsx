import { useState } from "react";
import { AppDialog } from "#/features/shared/AppDialog";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { Badge } from "#/features/shared/Badge";
import { Button, Group, Stack, Text } from "#/features/shared/mantine";
import { registrationRegionDecisionLabel } from "./event-registration-region-decision";
import {
  acknowledgeAdminEventRegistrationRegionMismatch,
  alignAdminEventRegistrationProfileRegion,
  confirmAdminEventRegistrationRegionGuest,
  reassignAdminEventRegistrationRegion,
} from "#/server/functions/admin-event-operations";

interface RegionReviewRegistration {
  id: string;
  name: string;
  status:
    | "submitted"
    | "coordinator_approved"
    | "coordinator_declined"
    | "selected"
    | "waitlisted"
    | "not_selected"
    | "withdrawn"
    | "cancelled";
  regionId: string | null;
  regionName: string | null;
  profileRegionId: string | null;
  profileRegionName: string | null;
  regionMismatch: boolean;
  regionMismatchAcknowledged: boolean;
  regionDecision: {
    resolution:
      | "registered_region_confirmed"
      | "profile_region_confirmed"
      | "profile_aligned_to_registration"
      | "region_guest_confirmed";
    classification: "event_region" | "outside_event_region" | "no_region_guest";
    reportingRegionNameSnapshot: string | null;
    reportingRegionGroupNameSnapshot: string | null;
  } | null;
  coordinatorDecidedAt: string | null;
  finalDecidedAt: string | null;
}

interface RegionReviewWorkspace {
  occurrence: { id: string };
  regions: Array<{
    id: string;
    regionId: string;
    name: string;
    effectivelyLocked: boolean;
  }>;
}

export function AdminEventRegistrationRegionDialog({
  workspace,
  registration,
  processingId,
  action,
  onClose,
}: {
  workspace: RegionReviewWorkspace;
  registration: RegionReviewRegistration;
  processingId: string | null;
  action: (
    id: string,
    operation: () => Promise<{ status: string; reason?: string }>,
    successMessage?: string,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const profileDestination = workspace.regions.find(
    (region) => region.regionId === registration.profileRegionId,
  );
  const [destinationRegionId, setDestinationRegionId] = useState(
    () => profileDestination?.id ?? registration.regionId ?? "",
  );
  const actionId = `reassign-region-${registration.id}`;
  const acknowledgeActionId = `acknowledge-region-${registration.id}`;
  const guestActionId = `region-guest-${registration.id}`;
  const alignProfileActionId = `align-profile-region-${registration.id}`;
  const processing =
    processingId === actionId ||
    processingId === acknowledgeActionId ||
    processingId === guestActionId ||
    processingId === alignProfileActionId;
  const destination = registration.regionMismatch
    ? profileDestination
    : workspace.regions.find((region) => region.id === destinationRegionId);
  const resolvedDestinationRegionId = destination?.id ?? "";
  const canUseProfileRegion = Boolean(
    registration.regionMismatch &&
    profileDestination &&
    profileDestination.id !== registration.regionId,
  );
  const canChangeRegion = Boolean(
    destination && destination.id !== registration.regionId,
  );
  const lockedDestinationOverride = Boolean(
    destination?.effectivelyLocked && !registration.finalDecidedAt,
  );
  const profileIsUnregional = registration.profileRegionId === null;
  const regionDecisionComplete = registration.regionDecision !== null;
  const canResolveAsRegionGuest =
    registration.regionMismatch &&
    !regionDecisionComplete &&
    !profileDestination &&
    registration.regionId !== null;
  const guestDecisionLabel = profileIsUnregional
    ? "Allow as region guest"
    : "Confirm outside-region guest";
  const confirmedDecisionLabel = registration.regionDecision
    ? registrationRegionDecisionLabel(registration.regionDecision)
    : null;

  return (
    <AppDialog
      title={
        registration.regionMismatch || registration.regionMismatchAcknowledged
          ? "Review registration region"
          : "Change registration region"
      }
      closeDisabled={processing}
      onClose={onClose}
    >
      <Stack gap="md">
        <Text fw={600}>{registration.name}</Text>
        {registration.regionMismatch ||
        registration.regionMismatchAcknowledged ? (
          <Stack gap="xs">
            <Group justify="space-between" align="center">
              <Text c="dimmed" size="sm">
                Registered region
              </Text>
              <Badge color="indigo" variant="light">
                {registration.regionName ?? "No region"}
              </Badge>
            </Group>
            <Group justify="space-between" align="center">
              <Text c="dimmed" size="sm">
                Current profile region
              </Text>
              <Badge color="orange" variant="light">
                {registration.profileRegionName ?? "No region"}
              </Badge>
            </Group>
            {confirmedDecisionLabel ? (
              <Badge color="green" variant="light">
                {confirmedDecisionLabel}
              </Badge>
            ) : null}
          </Stack>
        ) : null}
        {canChangeRegion && registration.finalDecidedAt ? (
          <Text c="red.7">
            Changing to {destination?.name} will retain the final decision and
            attendance evidence, but reset the regional review data.
          </Text>
        ) : canChangeRegion && lockedDestinationOverride ? (
          <Text c="red.7">
            {destination?.name} is locked. This change will bypass coordinator
            review and return the registration to the event administrator for a
            final decision.
          </Text>
        ) : canChangeRegion && registration.coordinatorDecidedAt ? (
          <Text>
            Changing to {destination?.name} will clear the existing coordinator
            decision and priority, then reopen coordinator review in that
            region.
          </Text>
        ) : null}
        {canResolveAsRegionGuest ? (
          <Text c="red.7">
            {profileIsUnregional
              ? "Confirming a region guest retains the selected region for coordinator review while reporting this attendee as having no current region. Updating the profile region also applies to future registrations."
              : "The current profile region is outside this event. Keep the selected region for coordinator review, then classify attendance against the current outside region for reporting."}
          </Text>
        ) : registration.regionMismatch &&
          !profileDestination &&
          !regionDecisionComplete ? (
          <Text c="red.7">
            The current profile region is not included in this event, so this
            registration can only retain its registered region.
          </Text>
        ) : null}
        {!registration.regionMismatch &&
        !registration.regionMismatchAcknowledged ? (
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
        ) : null}
        <Group justify="flex-end">
          {registration.regionMismatch &&
          !regionDecisionComplete &&
          !profileIsUnregional ? (
            <Button
              variant="light"
              loading={processingId === acknowledgeActionId}
              disabled={processing}
              onClick={() => {
                void action(
                  acknowledgeActionId,
                  async () => {
                    const outcome =
                      await acknowledgeAdminEventRegistrationRegionMismatch({
                        data: {
                          eventOccurrenceId: workspace.occurrence.id,
                          registrationId: registration.id,
                        },
                      });
                    if (outcome.status === "ready") onClose();
                    return outcome;
                  },
                  `Registration kept in ${registration.regionName ?? "its existing region"}.`,
                );
              }}
            >
              Keep registered region
            </Button>
          ) : null}
          {canResolveAsRegionGuest ? (
            <Button
              variant="light"
              loading={processingId === guestActionId}
              disabled={processing}
              onClick={() => {
                void action(
                  guestActionId,
                  async () => {
                    const outcome =
                      await confirmAdminEventRegistrationRegionGuest({
                        data: {
                          eventOccurrenceId: workspace.occurrence.id,
                          registrationId: registration.id,
                        },
                      });
                    if (outcome.status === "ready") onClose();
                    return outcome;
                  },
                  "Region guest confirmed.",
                );
              }}
            >
              {guestDecisionLabel}
            </Button>
          ) : null}
          {canResolveAsRegionGuest ? (
            <Button
              loading={processingId === alignProfileActionId}
              disabled={processing}
              onClick={() => {
                void action(
                  alignProfileActionId,
                  async () => {
                    const outcome =
                      await alignAdminEventRegistrationProfileRegion({
                        data: {
                          eventOccurrenceId: workspace.occurrence.id,
                          registrationId: registration.id,
                        },
                      });
                    if (outcome.status === "ready") onClose();
                    return outcome;
                  },
                  "Profile region updated.",
                );
              }}
            >
              Set profile to {registration.regionName}
            </Button>
          ) : null}
          {!regionDecisionComplete &&
          (!registration.regionMismatch || canUseProfileRegion) ? (
            <Button
              loading={processingId === actionId}
              disabled={
                processing ||
                !resolvedDestinationRegionId ||
                resolvedDestinationRegionId === registration.regionId
              }
              onClick={() => {
                void action(
                  actionId,
                  async () => {
                    const outcome = await reassignAdminEventRegistrationRegion({
                      data: {
                        eventOccurrenceId: workspace.occurrence.id,
                        registrationId: registration.id,
                        eventOccurrenceRegionId: resolvedDestinationRegionId,
                        confirmFinalizedReassignment: Boolean(
                          registration.finalDecidedAt,
                        ),
                        confirmLockedDestinationReassignment:
                          lockedDestinationOverride,
                      },
                    });
                    if (outcome.status === "ready") onClose();
                    return outcome;
                  },
                  "Registration region changed.",
                );
              }}
            >
              {registration.regionMismatch
                ? "Use current profile region"
                : registration.finalDecidedAt || lockedDestinationOverride
                  ? "Confirm region change"
                  : "Move registration"}
            </Button>
          ) : null}
        </Group>
      </Stack>
    </AppDialog>
  );
}
