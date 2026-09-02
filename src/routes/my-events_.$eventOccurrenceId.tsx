import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
import {
  Alert,
  Button,
  Container,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { LearnerProgramSections } from "#/features/learning/LearnerProgramSections";
import { LearnerCertificateAction } from "#/features/learner/LearnerCertificateAction";
import { learnerEventWorkspaceInputSchema } from "#/features/learner/learner-event-workspace.schema";
import { getLearnerEventWorkspace } from "#/server/functions/learner";
import { LearnerRegistrationQuestionnaire } from "#/features/registration/LearnerRegistrationQuestionnaire";
import classes from "#/features/learning/LearnerWorkspaceLayout.module.css";

export const Route = createFileRoute("/my-events_/$eventOccurrenceId")({
  ssr: "data-only",
  loader: async ({ params }) => {
    const parsed = learnerEventWorkspaceInputSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getLearnerEventWorkspace({ data: parsed.data });
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: {
          redirect: `/my-events/${encodeURIComponent(parsed.data.eventOccurrenceId)}`,
        },
      });
    if (result.status === "not-found") throw notFound();
    return result;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?.status === "ready"
            ? `${loaderData.workspace.title} — My events`
            : loaderData?.status === "registration-required"
              ? `Registration — ${loaderData.questionnaire.offeringTitle}`
              : "Event — My events",
      },
    ],
  }),
  component: LearnerEventWorkspacePage,
});

function LearnerEventWorkspacePage() {
  const result = Route.useLoaderData();
  if (result.status === "registration-required")
    return (
      <LearnerRegistrationQuestionnaire questionnaire={result.questionnaire} />
    );
  if (result.status === "cancelled")
    return (
      <Container size="sm" className={classes.page}>
        <Alert color="red" title="Event cancelled">
          {result.title} has been cancelled. Return to My events for your
          registration history.
        </Alert>
        <Button component={Link} to="/my-events" mt="lg">
          Back to My events
        </Button>
      </Container>
    );
  const workspace = result.workspace;
  return (
    <Container size="lg" className={classes.page}>
      <Stack gap="xl">
        <div>
          <Text c="indigo.7" fw={700}>
            Event workspace
          </Text>
          <Title order={1}>{workspace.title}</Title>
          <Text c="dimmed" mt="xs" maw={760}>
            {workspace.summary}
          </Text>
        </div>
        <div className={classes.layout}>
          <Paper withBorder radius="lg" p="lg" className={classes.summary}>
            <Stack gap="md">
              <Badge
                color={
                  workspace.completionState === "completed" ? "green" : "blue"
                }
                variant="light"
                w="fit-content"
              >
                {workspace.completionState === "completed"
                  ? "Completed"
                  : "In progress"}
              </Badge>
              {workspace.completedAt ? (
                <Text size="sm" c="dimmed">
                  Completed{" "}
                  {formatLocalDateTime(workspace.completedAt, {
                    timeZone: workspace.timezone,
                  })}
                </Text>
              ) : null}
              <div>
                <Text size="sm" c="dimmed">
                  Schedule
                </Text>
                <Text fw={600}>
                  {formatLocalDateTime(workspace.startsAt, {
                    timeZone: workspace.timezone,
                  })}
                </Text>
                <Text size="sm" c="dimmed">
                  to{" "}
                  {formatLocalDateTime(workspace.endsAt, {
                    timeZone: workspace.timezone,
                  })}
                </Text>
              </div>
              {workspace.deliveryMode === "in_person" ? (
                <div>
                  <Text size="sm" c="dimmed">
                    Venue
                  </Text>
                  <Text fw={600}>{workspace.venueName}</Text>
                  {workspace.venueAddress ? (
                    <Text size="sm">{workspace.venueAddress}</Text>
                  ) : null}
                </div>
              ) : (
                <Text size="sm">Virtual event</Text>
              )}
              {workspace.certificateAvailable ? (
                <LearnerCertificateAction
                  certificate={{
                    eventParticipationId: workspace.eventParticipationId,
                  }}
                />
              ) : null}
              <Button component={Link} to="/my-events" variant="light">
                Back to My events
              </Button>
            </Stack>
          </Paper>
          <Stack gap="xl">
            <div>
              <Title order={2}>Event program</Title>
              {workspace.description ? (
                <Text c="dimmed" mt={4}>
                  {workspace.description}
                </Text>
              ) : null}
            </div>
            <LearnerProgramSections
              kind="event"
              eventOccurrenceId={workspace.eventOccurrenceId}
              eventParticipationId={workspace.eventParticipationId}
              sections={workspace.sections}
              timezone={workspace.timezone}
            />
          </Stack>
        </div>
      </Stack>
    </Container>
  );
}
