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
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { getAssignedEventOperations } from "#/server/functions/event-operations";
import classes from "#/features/event-operations/EventOperations.module.css";

export const Route = createFileRoute("/event-operations/")({
  loader: async () => {
    const result = await getAssignedEventOperations();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/event-operations" },
      });
    return result.data;
  },
  component: AssignedEventOperationsPage,
});

function AssignedEventOperationsPage() {
  const events = Route.useLoaderData();
  return (
    <Stack gap="lg">
      <div>
        <Text c="indigo.7" fw={700}>
          Assigned delivery
        </Text>
        <Title order={1}>Event operations</Title>
        <Text c="dimmed" mt="xs" maw={720}>
          Review registrations and manage attendance only for the event regions
          and sessions assigned to you.
        </Text>
      </div>

      {events.length === 0 ? (
        <Alert title="No active event assignments">
          Assigned events will appear here when an administrator adds you as an
          event administrator, coordinator or presenter.
        </Alert>
      ) : (
        <div className={classes.eventGrid}>
          {events.map((event) => (
            <Paper
              component="article"
              withBorder
              radius="lg"
              p="md"
              key={event.id}
            >
              <Stack gap="md" h="100%">
                <Group justify="space-between" align="start" wrap="wrap">
                  <div>
                    <Title order={2}>{event.title}</Title>
                    <Text c="dimmed" size="sm" mt={4}>
                      {formatLocalDateTime(event.startsAt, {
                        timeZone: event.timezone,
                      })}
                    </Text>
                  </div>
                  <Badge variant="light">{event.status}</Badge>
                </Group>
                <Group gap="xs">
                  {event.roles.map((role) => (
                    <Badge key={role} color="teal" variant="light">
                      {role}
                    </Badge>
                  ))}
                </Group>
                {event.regions.length ? (
                  <Text size="sm">Regions: {event.regions.join(", ")}</Text>
                ) : null}
                {event.sessions.length ? (
                  <Text size="sm">Sessions: {event.sessions.join(", ")}</Text>
                ) : null}
                <Text size="sm" c="dimmed">
                  {event.deliveryMode === "virtual"
                    ? "Virtual delivery"
                    : event.venueName || "In-person delivery"}
                </Text>
                <Link
                  to="/event-operations/$eventOccurrenceId"
                  params={{ eventOccurrenceId: event.id }}
                  search={{ view: "overview", q: "", state: "all" }}
                  className={classes.workspaceLink}
                >
                  <Button component="span" fullWidth>
                    Open workspace
                  </Button>
                </Link>
              </Stack>
            </Paper>
          ))}
        </div>
      )}
    </Stack>
  );
}
