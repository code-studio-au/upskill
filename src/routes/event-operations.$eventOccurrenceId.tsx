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
const EventOperationsProgress = lazy(async () => {
  const module =
    await import("#/features/event-operations/EventOperationsProgress");
  return { default: module.EventOperationsProgress };
});
const EventOperationsSurveyQrCatalogue = lazy(async () => {
  const module =
    await import("#/features/event-operations/EventOperationsSurveyQrCatalogue");
  return { default: module.EventOperationsSurveyQrCatalogue };
});
const EventOperationsVirtualSessions = lazy(async () => {
  const module =
    await import("#/features/event-operations/EventOperationsVirtualSessions");
  return { default: module.EventOperationsVirtualSessions };
});

type EventOperationsView =
  | "overview"
  | "registrations"
  | "virtual_sessions"
  | "progress"
  | "attendance"
  | "survey_qr";

const searchSchema = z.object({
  q: z.catch(z.string().check(z.trim(), z.maxLength(100)), ""),
  state: z.catch(
    z.enum(["all", "not_started", "in_progress", "up_to_date", "completed"]),
    "all",
  ),
  view: z.catch(
    z.enum([
      "overview",
      "registrations",
      "virtual_sessions",
      "progress",
      "attendance",
      "survey_qr",
    ]),
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
    ...(workspace.virtualSessions.length
      ? [{ value: "virtual_sessions" as const, label: "Webinar operations" }]
      : []),
    ...(workspace.access.canViewProgress
      ? [
          {
            value: "progress" as const,
            label: `Progress (${String(workspace.participantProgress.length)})`,
          },
        ]
      : []),
    ...(workspace.access.canViewSurveyQrCatalogue
      ? [
          {
            value: "survey_qr" as const,
            label: `Survey QR codes (${String(workspace.surveyQrCatalogue.length)})`,
          },
        ]
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
          capacity_exceeded:
            "This webinar exceeds the LiveKit capacity approved for this environment.",
          not_livekit: "This session is not configured for LiveKit.",
          occurrence_unavailable:
            "Webinar operations are available only for a published event.",
          preparation_not_open:
            "The presenter preparation window has not opened yet.",
          provider_pending:
            "Another provider operation is still in progress. Try again shortly.",
          provider_unavailable:
            "LiveKit is unavailable or not configured. No room credentials were disclosed.",
          recording_unavailable:
            "Automatic recording is not available in this delivery slice, so the webinar was not started.",
          room_not_ready:
            "Prepare the green room and wait for LiveKit readiness before continuing.",
          session_ended: "This webinar session has ended.",
          locked_destination_reassignment_confirmation_required:
            "Confirm the move into the locked regional list.",
          finalized_reassignment_confirmation_required:
            "Confirm the region change for this finalized registration.",
          region_mismatch_resolved:
            "The learner's profile region now matches this registration.",
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

      {error ? (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      ) : null}

      <PageTabs
        label="Assigned event workspace"
        value={activeView}
        tabs={tabs}
        onChange={(view) =>
          void navigate({
            search: { view, q: search.q, state: search.state },
          })
        }
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
        {activeView === "virtual_sessions" ? (
          <EventOperationsVirtualSessions
            workspace={workspace}
            processingId={processingId}
            action={action}
          />
        ) : null}
        {activeView === "progress" ? (
          <EventOperationsProgress
            workspace={workspace}
            filters={{ q: search.q, state: search.state }}
            onFiltersChange={(filters) =>
              void navigate({
                search: { view: "progress", ...filters },
                resetScroll: false,
              })
            }
          />
        ) : null}
        {activeView === "survey_qr" ? (
          <EventOperationsSurveyQrCatalogue workspace={workspace} />
        ) : null}
      </Suspense>
    </Stack>
  );
}
