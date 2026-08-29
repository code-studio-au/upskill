import type { AdminLearnerEvent } from "./admin.schema";
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
import { Link } from "@tanstack/react-router";
import classes from "./AdminLearnerEventHistory.module.css";
import {
  eventProgressColor,
  learnerEventState,
  readableEventValue,
} from "./admin-learner-event-display";

export function AdminLearnerEventHistory({
  events,
  userId,
}: {
  events: Array<AdminLearnerEvent>;
  userId: string;
}) {
  if (events.length === 0)
    return (
      <Paper withBorder radius="lg" p="xl">
        <Text fw={600}>
          This learner has no event registrations or participation.
        </Text>
      </Paper>
    );

  return (
    <div className={classes.eventGrid}>
      {events.map((event) => (
        <Paper
          component="article"
          withBorder
          radius="lg"
          p="lg"
          key={event.key}
        >
          <Stack gap="md">
            <div className={classes.eventHeader}>
              <div>
                <Text c="indigo.7" fw={700} size="sm">
                  {event.occurrence.eventTemplateTitle} · Published V
                  {event.occurrence.eventTemplateVersion}
                </Text>
                <Title order={3}>{event.occurrence.title}</Title>
                <Text c="dimmed" size="sm" mt={4}>
                  {formatLocalDateTime(event.occurrence.startsAt, {
                    timeZone: event.occurrence.timezone,
                  })}
                </Text>
              </div>
              <Group gap="xs">
                <Badge
                  color={
                    event.occurrence.status === "cancelled" ? "red" : "gray"
                  }
                >
                  {readableEventValue(event.occurrence.status)}
                </Badge>
                <Badge
                  color={eventProgressColor(
                    event.progress?.state ?? event.registration?.status ?? "",
                  )}
                >
                  {learnerEventState(event)}
                </Badge>
              </Group>
            </div>
            <Stack gap="xs">
              <Link
                to="/admin/learners/$userId/events/$eventOccurrenceId"
                params={{ userId, eventOccurrenceId: event.occurrence.id }}
                className={classes.buttonLink}
              >
                <Button component="span" fullWidth>
                  Review progress
                </Button>
              </Link>
              <Button
                component="a"
                href={`/admin/events/instances/${encodeURIComponent(event.occurrence.id)}`}
                variant="subtle"
                fullWidth
              >
                View scheduled event
              </Button>
            </Stack>
          </Stack>
        </Paper>
      ))}
    </div>
  );
}
