import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
import {
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import type { EventOperationsWorkspace } from "./event-operations.schema";
import { lockEventOperationsRegion } from "#/server/functions/event-operations";
import classes from "./EventOperations.module.css";

export type EventOperationsAction = (
  id: string,
  operation: () => Promise<{ status: string; reason?: string }>,
) => Promise<void>;

export function EventOperationsOverview({
  workspace,
  processingId,
  action,
}: {
  workspace: EventOperationsWorkspace;
  processingId: string | null;
  action: EventOperationsAction;
}) {
  return (
    <Stack gap="lg">
      <div className={classes.summaryGrid}>
        {workspace.guestAccess ? (
          <Paper withBorder radius="lg" p="md">
            <Title order={2}>Guest access</Title>
            <Text mt="xs" className={classes.guestLink}>
              /event-access/{workspace.guestAccess.publicReference}
            </Text>
            <Button
              variant="light"
              mt="sm"
              onClick={() => {
                const url = new URL(
                  `/event-access/${workspace.guestAccess?.publicReference ?? ""}`,
                  window.location.origin,
                ).toString();
                void navigator.clipboard.writeText(url);
              }}
            >
              Copy guest link
            </Button>
          </Paper>
        ) : null}
        <Paper withBorder radius="lg" p="md">
          <Title order={2}>Schedule</Title>
          <Text mt="xs">
            {formatLocalDateTime(workspace.occurrence.startsAt, {
              timeZone: workspace.occurrence.timezone,
            })}
          </Text>
          <Text c="dimmed" size="sm">
            to{" "}
            {formatLocalDateTime(workspace.occurrence.endsAt, {
              timeZone: workspace.occurrence.timezone,
            })}
          </Text>
        </Paper>
        <Paper withBorder radius="lg" p="md">
          <Title order={2}>Delivery</Title>
          <Text mt="xs">
            {workspace.occurrence.deliveryMode === "virtual"
              ? workspace.occurrence.virtualDeliveryProvider === "livekit"
                ? "LiveKit Cloud webinar"
                : "Virtual event · protected external URL"
              : workspace.occurrence.venueName || "In-person event"}
          </Text>
          {workspace.occurrence.venueAddress ? (
            <Text c="dimmed" size="sm">
              {workspace.occurrence.venueAddress}
            </Text>
          ) : null}
          {workspace.occurrence.deliveryMode === "virtual" &&
          workspace.occurrence.virtualJoinUrl ? (
            <Button
              component="a"
              href={workspace.occurrence.virtualJoinUrl}
              target="_blank"
              rel="noreferrer"
              variant="light"
              mt="sm"
            >
              Open meeting
            </Button>
          ) : null}
        </Paper>
      </div>
      {workspace.access.canViewRegistrations ? (
        <div className={classes.metricGrid}>
          {[
            ["Registrations", workspace.metrics.registrations],
            ["Awaiting review", workspace.metrics.awaitingReview],
            ["Candidates", workspace.metrics.candidates],
            ["Confirmed", workspace.metrics.confirmed],
          ].map(([label, value]) => (
            <Paper withBorder radius="lg" p="md" key={label}>
              <Text c="dimmed" size="sm">
                {label}
              </Text>
              <Text className={classes.metricValue}>{value}</Text>
            </Paper>
          ))}
        </div>
      ) : null}
      {workspace.regions.length ? (
        <div className={classes.summaryGrid}>
          {workspace.regions.map((region) => (
            <Paper withBorder radius="lg" p="md" key={region.id}>
              <Stack gap="sm">
                <Group justify="space-between" align="start">
                  <Title order={3}>{region.name}</Title>
                  <Badge
                    variant="light"
                    color={region.effectivelyLocked ? "gray" : "blue"}
                  >
                    {region.effectivelyLocked ? "Locked" : "Review open"}
                  </Badge>
                </Group>
                <Text size="sm">{region.registrationCount} registrations</Text>
                {!region.effectivelyLocked ? (
                  <Button
                    variant="light"
                    loading={processingId === `lock-${region.id}`}
                    onClick={() =>
                      void action(`lock-${region.id}`, () =>
                        lockEventOperationsRegion({
                          data: {
                            eventOccurrenceId: workspace.occurrence.id,
                            eventOccurrenceRegionId: region.id,
                          },
                        }),
                      )
                    }
                  >
                    Lock regional list
                  </Button>
                ) : null}
              </Stack>
            </Paper>
          ))}
        </div>
      ) : null}
    </Stack>
  );
}
