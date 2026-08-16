import { Link } from "@tanstack/react-router";
import type {
  EventOperationsWorkspace,
  EventSurveyQrCatalogueItem,
} from "./event-operations.schema";
import { Badge } from "#/features/shared/Badge";
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

const releaseAnchorLabels: Record<
  EventSurveyQrCatalogueItem["releaseAnchor"],
  string
> = {
  participation_created: "participant confirmation",
  occurrence_start: "event start",
  occurrence_end: "event end",
  final_session_end: "final session end",
};

function availabilityDescription(entry: EventSurveyQrCatalogueItem): string {
  const anchor = releaseAnchorLabels[entry.releaseAnchor];
  const amount = entry.releaseOffsetAmount;
  if (amount === 0) return `Available at ${anchor}`;
  const absolute = Math.abs(amount);
  return `Available ${String(absolute)} ${entry.releaseOffsetUnit}${absolute === 1 ? "" : "s"} ${amount < 0 ? "before" : "after"} ${anchor}`;
}

export function EventOperationsSurveyQrCatalogue({
  workspace,
}: {
  workspace: EventOperationsWorkspace;
}) {
  return (
    <Stack gap="lg">
      <Title order={2}>Survey QR catalogue</Title>

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
                    {availabilityDescription(entry)}
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
