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

function readable(value: string): string {
  const text = value.replaceAll("_", " ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function registrationColor(status: string): string {
  if (status === "selected") return "green";
  if (["cancelled", "withdrawn", "not_selected"].includes(status)) return "red";
  if (status === "waitlisted" || status === "coordinator_approved")
    return "orange";
  return "blue";
}

function progressColor(state: string): string {
  if (state === "completed" || state === "up_to_date") return "green";
  if (state === "locked" || state === "not_started") return "gray";
  return "blue";
}

function eventState(event: AdminLearnerEvent): string {
  if (event.progress) return readable(event.progress.state);
  if (event.participation?.completedAt) return "Completed";
  if (event.participation?.checkedInAt) return "Checked in";
  if (event.registration) return readable(event.registration.status);
  return event.participation ? "Participating" : "No participation";
}

function eventColor(event: AdminLearnerEvent): string {
  if (event.progress) return progressColor(event.progress.state);
  if (event.participation?.completedAt) return "green";
  if (event.participation?.checkedInAt) return "blue";
  return registrationColor(event.registration?.status ?? "");
}

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
                  {readable(event.occurrence.status)}
                </Badge>
                <Badge color={eventColor(event)}>{eventState(event)}</Badge>
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
