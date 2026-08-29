import type { AdminLearnerEvent } from "./admin.schema";
import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { LearnerProgressCard } from "#/features/shared/LearnerProgressCard";
import { Button, Group, Paper, Text } from "#/features/shared/mantine";
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
      {events.map((event) => {
        return (
          <LearnerProgressCard
            key={event.key}
            className={classes.eventCard}
            title={event.occurrence.title}
            subtitle={
              <>
                {event.occurrence.eventTemplateTitle} · Version{" "}
                {event.occurrence.eventTemplateVersion}
              </>
            }
            status={
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
            }
            progress={event.progress?.sections ?? []}
            progressTitle="Event progress"
            actions={
              <>
                <Link
                  to="/admin/learners/$userId/events/$eventOccurrenceId"
                  params={{
                    userId,
                    eventOccurrenceId: event.occurrence.id,
                  }}
                  className={classes.buttonLink}
                >
                  <Button component="span" fullWidth>
                    Review progress
                  </Button>
                </Link>
                <Button
                  component="a"
                  href={`/admin/events/instances/${encodeURIComponent(event.occurrence.id)}`}
                  className={classes.buttonLink}
                  variant="subtle"
                  fullWidth
                >
                  View scheduled event
                </Button>
              </>
            }
          >
            <Text size="sm">
              Starts{" "}
              {formatLocalDateTime(event.occurrence.startsAt, {
                timeZone: event.occurrence.timezone,
              })}
            </Text>
          </LearnerProgressCard>
        );
      })}
    </div>
  );
}
