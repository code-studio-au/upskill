import { useState } from "react";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { Badge } from "#/features/shared/Badge";
import { PageTabs } from "#/features/shared/PageTabs";
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
import { z } from "#/validation/zod";
import classes from "./admin.events.module.css";

const searchSchema = z.object({
  view: z.catch(z.enum(["upcoming", "historical"]), "upcoming"),
});

export const Route = createFileRoute("/admin/events/scheduled")({
  validateSearch: searchSchema,
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
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (result.status === "forbidden") return <AdminAccessDenied />;
  const workspace = result.data;
  const historicalStatuses = new Set(["cancelled", "completed", "archived"]);
  const upcoming = workspace.occurrences.filter(
    (occurrence) => !historicalStatuses.has(occurrence.status),
  );
  const historical = workspace.occurrences
    .filter((occurrence) => historicalStatuses.has(occurrence.status))
    .toReversed();
  const visibleOccurrences =
    search.view === "historical" ? historical : upcoming;

  async function publishOccurrence(eventOccurrenceId: string) {
    setProcessingId(eventOccurrenceId);
    setError(null);
    try {
      const outcome = await publishAdminEventOccurrence({
        data: { eventOccurrenceId },
      });
      if (outcome.status !== "ready") {
        if (
          outcome.status === "conflict" &&
          outcome.reason === "livekit_unavailable"
        ) {
          setError(
            "LiveKit delivery is not yet available. Keep this occurrence as a draft until the lobby and webinar workflow is ready.",
          );
          return;
        }
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

      <PageTabs
        label="Scheduled event status"
        value={search.view}
        tabs={[
          { value: "upcoming", label: `Upcoming (${String(upcoming.length)})` },
          {
            value: "historical",
            label: `Historical (${String(historical.length)})`,
          },
        ]}
        onChange={(view) => void navigate({ search: { view } })}
      />

      {visibleOccurrences.length === 0 ? (
        <Alert
          title={
            search.view === "historical"
              ? "No historical events"
              : "No upcoming events"
          }
        >
          {search.view === "historical"
            ? "Completed, cancelled and archived events will appear here."
            : "Publish an event template, then schedule its first event."}
        </Alert>
      ) : (
        <div
          className={[classes.cardGrid, classes.scheduledGrid]
            .filter(Boolean)
            .join(" ")}
        >
          {visibleOccurrences.map((occurrence) => (
            <Paper
              component="article"
              key={occurrence.id}
              withBorder
              radius="lg"
              p="md"
              className={classes.scheduledCard}
            >
              <Stack gap="md">
                <Group justify="space-between" align="start" wrap="nowrap">
                  <div className={classes.cardIdentity}>
                    <Link
                      to="/admin/events/instances/$eventOccurrenceId"
                      params={{ eventOccurrenceId: occurrence.id }}
                      search={{ view: "overview" }}
                      className={classes.cardTitleLink}
                    >
                      <Title order={3}>{occurrence.title}</Title>
                    </Link>
                    <Text size="sm" c="dimmed">
                      {occurrence.eventTemplateTitle}
                    </Text>
                  </div>
                  <Badge
                    color={occurrence.status === "published" ? "green" : "gray"}
                    variant="light"
                  >
                    {occurrence.status}
                  </Badge>
                </Group>
                <Text fw={700} className={classes.eventDate}>
                  {formatEventDate(occurrence.startsAt, occurrence.timezone)} –{" "}
                  {formatEventDate(occurrence.endsAt, occurrence.timezone)}
                </Text>
                {occurrence.regions ? (
                  <Text size="sm" c="dimmed">
                    {occurrence.regions}
                  </Text>
                ) : null}
                <Group gap="xs" wrap="wrap" className={classes.eventMeta}>
                  <Badge variant="light">
                    {readable(occurrence.deliveryMode)}
                  </Badge>
                  <Badge variant="light" color="gray">
                    {occurrence.confirmedCount}/{occurrence.capacity} confirmed
                  </Badge>
                </Group>
                {occurrence.status === "draft" ? (
                  <Group justify="flex-end">
                    <Button
                      loading={processingId === occurrence.id}
                      onClick={() => void publishOccurrence(occurrence.id)}
                    >
                      Publish event
                    </Button>
                  </Group>
                ) : null}
              </Stack>
            </Paper>
          ))}
        </div>
      )}
    </Stack>
  );
}
