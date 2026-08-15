import { useState } from "react";
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
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
import {
  getAdminEventWorkspace,
  publishAdminEventOccurrence,
} from "#/server/functions/admin-event";
import classes from "./admin.events.module.css";

export const Route = createFileRoute("/admin/events/scheduled")({
  ssr: false,
  loader: async () => {
    const result = await getAdminEventWorkspace();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/events/scheduled" },
      });
    return result;
  },
  component: ScheduledEventsPage,
});

function formatEventDate(value: string, timezone: string): string {
  return formatLocalDateTime(value, { timeZone: timezone });
}

function readable(value: string): string {
  return value.replaceAll("_", " ");
}

function ScheduledEventsPage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (result.status === "forbidden") return <AdminAccessDenied />;
  const workspace = result.data;

  async function publishOccurrence(eventOccurrenceId: string) {
    setProcessingId(eventOccurrenceId);
    setError(null);
    try {
      const outcome = await publishAdminEventOccurrence({
        data: { eventOccurrenceId },
      });
      if (outcome.status !== "ready") {
        setError(
          "The event cannot be published until schedule, location, domains and staff coverage are complete.",
        );
        return;
      }
      await router.invalidate();
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Text c="indigo.7" fw={700}>
            Events
          </Text>
          <Title order={1}>Scheduled events</Title>
          <Text c="dimmed" mt="xs" maw={760}>
            Manage dated event instances, registration, regional review,
            staffing, attendance and participant progress.
          </Text>
        </div>
        <Button
          component={Link}
          to="/admin/events/instances/new"
          disabled={workspace.publishedVersions.length === 0}
        >
          Schedule event
        </Button>
      </Group>

      {error ? <Alert color="red">{error}</Alert> : null}

      {workspace.occurrences.length === 0 ? (
        <Alert title="No events scheduled">
          Publish an event template, then schedule its first event.
        </Alert>
      ) : (
        <div className={classes.cardGrid}>
          {workspace.occurrences.map((occurrence) => (
            <Paper
              component="article"
              key={occurrence.id}
              withBorder
              radius="lg"
              p="md"
            >
              <Stack gap="sm">
                <Group justify="space-between" align="start" wrap="nowrap">
                  <div>
                    <Title order={3}>{occurrence.title}</Title>
                    <Text size="sm" c="dimmed">
                      {occurrence.eventTemplateTitle} · Version{" "}
                      {occurrence.templateVersion}
                    </Text>
                    <Text size="sm" c="dimmed">
                      /events/{occurrence.slug}
                    </Text>
                  </div>
                  <Badge
                    color={occurrence.status === "published" ? "green" : "gray"}
                    variant="light"
                  >
                    {occurrence.status}
                  </Badge>
                </Group>
                <Text size="sm">
                  {formatEventDate(occurrence.startsAt, occurrence.timezone)} –{" "}
                  {formatEventDate(occurrence.endsAt, occurrence.timezone)} ·{" "}
                  {occurrence.timezone}
                </Text>
                <Text size="sm" c="dimmed">
                  {readable(occurrence.deliveryMode)} ·{" "}
                  {readable(occurrence.registrationMode)} · capacity{" "}
                  {occurrence.confirmedCount}/{occurrence.capacity}
                </Text>
                <Text size="sm" c="dimmed">
                  {occurrence.sessionCount} session
                  {occurrence.sessionCount === 1 ? "" : "s"} ·{" "}
                  {occurrence.assignedAdminCount} assigned administrator
                  {occurrence.assignedAdminCount === 1 ? "" : "s"}
                </Text>
                <Group grow wrap="wrap">
                  <Button
                    variant="light"
                    onClick={() => {
                      void router.navigate({
                        to: "/admin/events/instances/$eventOccurrenceId",
                        params: { eventOccurrenceId: occurrence.id },
                        search: { view: "overview" },
                      });
                    }}
                  >
                    Open event
                  </Button>
                  {occurrence.status === "draft" ? (
                    <Button
                      variant="subtle"
                      onClick={() => {
                        void router.navigate({
                          to: "/admin/events/instances/$eventOccurrenceId",
                          params: { eventOccurrenceId: occurrence.id },
                          search: { view: "configuration" },
                        });
                      }}
                    >
                      Edit configuration
                    </Button>
                  ) : null}
                  {occurrence.status === "draft" ? (
                    <Button
                      loading={processingId === occurrence.id}
                      onClick={() => void publishOccurrence(occurrence.id)}
                    >
                      Publish event
                    </Button>
                  ) : null}
                </Group>
              </Stack>
            </Paper>
          ))}
        </div>
      )}
    </Stack>
  );
}
