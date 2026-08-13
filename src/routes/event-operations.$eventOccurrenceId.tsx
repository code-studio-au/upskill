import { lazy, Suspense, useState } from "react";
import {
  createFileRoute,
  notFound,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import type { EventOperationsAction } from "#/features/event-operations/EventOperationsOverview";
import { eventOperationsParamsSchema } from "#/features/event-operations/event-operations.schema";
import { Badge } from "#/features/shared/Badge";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
import { PageTabs, type PageTab } from "#/features/shared/PageTabs";
import { Alert, Group, Stack, Text, Title } from "#/features/shared/mantine";
import { getEventOperationsWorkspace } from "#/server/functions/event-operations";
import { z } from "#/validation/zod";

const EventOperationsOverview = lazy(async () => {
  const module =
    await import("#/features/event-operations/EventOperationsOverview");
  return { default: module.EventOperationsOverview };
});
const EventOperationsRegistrationReview = lazy(async () => {
  const module =
    await import("#/features/event-operations/EventOperationsRegistrationReview");
  return { default: module.EventOperationsRegistrationReview };
});
const EventOperationsAttendance = lazy(async () => {
  const module =
    await import("#/features/event-operations/EventOperationsAttendance");
  return { default: module.EventOperationsAttendance };
});

type EventOperationsView = "overview" | "registrations" | "attendance";

const searchSchema = z.object({
  view: z.catch(
    z.enum(["overview", "registrations", "attendance"]),
    "overview",
  ),
});

export const Route = createFileRoute("/event-operations/$eventOccurrenceId")({
  validateSearch: searchSchema,
  loader: async ({ params }) => {
    const parsed = eventOperationsParamsSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getEventOperationsWorkspace({ data: parsed.data });
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: {
          redirect: `/event-operations/${encodeURIComponent(parsed.data.eventOccurrenceId)}`,
        },
      });
    if (result.status === "not-found") throw notFound();
    return result;
  },
  component: EventOperationsPage,
});

function EventOperationsPage() {
  const result = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [priorities, setPriorities] = useState<Record<string, string>>({});
  if (result.status === "forbidden")
    return (
      <Alert color="red" title="Event access unavailable">
        You do not have an active assignment for this event.
      </Alert>
    );
  const workspace = result.data;
  const tabs: Array<PageTab<EventOperationsView>> = [
    { value: "overview", label: "Overview" },
    ...(workspace.access.canViewRegistrations
      ? [
          {
            value: "registrations" as const,
            label: `Regional review (${String(workspace.metrics.registrations)})`,
          },
        ]
      : []),
    ...(workspace.sessions.length
      ? [{ value: "attendance" as const, label: "Sessions & attendance" }]
      : []),
  ];
  const activeView = tabs.some((tab) => tab.value === search.view)
    ? search.view
    : "overview";

  const action: EventOperationsAction = async (id, operation) => {
    setProcessingId(id);
    setError(null);
    try {
      const outcome = await operation();
      if (outcome.status !== "ready") {
        const messages: Record<string, string> = {
          region_locked: "This regional review list is already locked.",
          invalid_transition:
            "That action is not available from the current state.",
          attendance_unavailable:
            "Attendance could not be recorded for that participant.",
        };
        setError(
          outcome.status === "forbidden"
            ? "Your assignment no longer permits this action."
            : (messages[outcome.reason ?? ""] ??
                "The event operation could not be completed."),
        );
        return;
      }
      await router.invalidate();
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <Stack gap="lg">
      <div>
        <Text c="indigo.7" fw={700}>
          Assigned event
        </Text>
        <Title order={1}>{workspace.occurrence.title}</Title>
        <Group gap="xs" mt="xs">
          {workspace.access.roles.map((role) => (
            <Badge color="teal" variant="light" key={role}>
              {role}
            </Badge>
          ))}
          <Badge variant="light">{workspace.occurrence.status}</Badge>
        </Group>
      </div>

      {error ? <Alert color="red">{error}</Alert> : null}

      <PageTabs
        label="Assigned event workspace"
        value={activeView}
        tabs={tabs}
        onChange={(view) => void navigate({ search: { view } })}
      />

      <Suspense fallback={<LoadingSpinner label="Loading event workspace" />}>
        {activeView === "overview" ? (
          <EventOperationsOverview
            workspace={workspace}
            processingId={processingId}
            action={action}
          />
        ) : null}
        {activeView === "registrations" ? (
          <EventOperationsRegistrationReview
            workspace={workspace}
            priorities={priorities}
            processingId={processingId}
            setPriorities={setPriorities}
            action={action}
          />
        ) : null}
        {activeView === "attendance" ? (
          <EventOperationsAttendance
            workspace={workspace}
            processingId={processingId}
            action={action}
          />
        ) : null}
      </Suspense>
    </Stack>
  );
}
