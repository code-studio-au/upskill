import { Link } from "@tanstack/react-router";
import type {
  EventOperationsWorkspace,
  EventSurveyQrCatalogueItem,
} from "./event-operations.schema";
import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import classes from "./EventOperations.module.css";

const phaseLabels: Record<EventSurveyQrCatalogueItem["phase"], string> = {
  pre_event: "Pre-event",
  session: "Event session",
  post_event: "Post-event",
  follow_up: "Follow-up",
};

function offsetDescription(minutes: number): string {
  if (minutes === 0) return "at the release anchor";
  const absolute = Math.abs(minutes);
  const quantity =
    absolute % 1_440 === 0
      ? `${String(absolute / 1_440)} day${absolute === 1_440 ? "" : "s"}`
      : absolute % 60 === 0
        ? `${String(absolute / 60)} hour${absolute === 60 ? "" : "s"}`
        : `${String(absolute)} minute${absolute === 1 ? "" : "s"}`;
  return `${quantity} ${minutes < 0 ? "before" : "after"} the release anchor`;
}

function availabilityDescription(
  entry: EventSurveyQrCatalogueItem,
  workspace: EventOperationsWorkspace,
): string {
  if (entry.releaseAnchor === "participation_created")
    return entry.releaseOffsetMinutes === 0
      ? "Available when each participant is confirmed"
      : `Available ${offsetDescription(entry.releaseOffsetMinutes).replace("the release anchor", "each participant is confirmed")}`;
  const anchor =
    entry.releaseAnchor === "occurrence_start"
      ? workspace.occurrence.startsAt
      : entry.releaseAnchor === "occurrence_end"
        ? workspace.occurrence.endsAt
        : (workspace.sessions.at(-1)?.endsAt ?? workspace.occurrence.endsAt);
  const releaseAt = new Date(
    new Date(anchor).getTime() + entry.releaseOffsetMinutes * 60_000,
  ).toISOString();
  return `Available from ${formatLocalDateTime(releaseAt, {
    timeZone: workspace.occurrence.timezone,
  })}`;
}

export function EventOperationsSurveyQrCatalogue({
  workspace,
}: {
  workspace: EventOperationsWorkspace;
}) {
  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Survey QR catalogue</Title>
        <Text c="dimmed" size="sm" maw={760}>
          Each code resolves to one exact Survey in this Event Instance. A scan
          never bypasses sign-in, participant selection or the Section release
          schedule.
        </Text>
      </div>

      {workspace.surveyQrCatalogue.length ? (
        <div className={classes.qrCatalogueGrid}>
          {workspace.surveyQrCatalogue.map((entry) => (
            <Paper withBorder radius="lg" p="md" key={entry.id}>
              <Stack gap="md" h="100%">
                <Group justify="space-between" align="start" wrap="nowrap">
                  <div>
                    <Text fw={700}>{entry.title}</Text>
                    <Text c="dimmed" size="sm">
                      {entry.sectionTitle}
                    </Text>
                  </div>
                  <Badge
                    color={
                      entry.status === "active"
                        ? "green"
                        : entry.status === "preview"
                          ? "orange"
                          : "gray"
                    }
                    variant="light"
                  >
                    {entry.status}
                  </Badge>
                </Group>
                <div>
                  <Text size="sm" fw={600}>
                    {phaseLabels[entry.phase]}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {availabilityDescription(entry, workspace)}
                  </Text>
                </div>
                <Text size="xs" c="dimmed" className={classes.qrPath}>
                  /event-surveys/{entry.publicReference}
                </Text>
                {entry.status === "disabled" ? (
                  <div className={classes.qrPresentationLink}>
                    <Button disabled fullWidth>
                      QR code disabled
                    </Button>
                  </div>
                ) : (
                  <Link
                    to="/event-operations/$eventOccurrenceId/survey-qr/$eventSurveyAccessId"
                    params={{
                      eventOccurrenceId: workspace.occurrence.id,
                      eventSurveyAccessId: entry.id,
                    }}
                    className={classes.qrPresentationLink}
                  >
                    <Button component="span" fullWidth>
                      Present QR code
                    </Button>
                  </Link>
                )}
              </Stack>
            </Paper>
          ))}
        </div>
      ) : (
        <Alert title="No Survey QR codes">
          This exact Event Template Version does not contain any Survey
          activities.
        </Alert>
      )}
    </Stack>
  );
}
