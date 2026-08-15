import {
  createFileRoute,
  Link,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { eventSurveyPublicReferenceSchema } from "#/features/event-operations/event-operations.schema";
import {
  Alert,
  Button,
  Container,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { resolveLearnerEventSurveyQr } from "#/server/functions/learner";

export const Route = createFileRoute("/event-surveys/$publicReference")({
  ssr: "data-only",
  loader: async ({ params }) => {
    const parsed = eventSurveyPublicReferenceSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const destination = `/event-surveys/${encodeURIComponent(parsed.data.publicReference)}`;
    const result = await resolveLearnerEventSurveyQr({ data: parsed.data });
    if (result.status === "unauthenticated")
      throw redirect({ to: "/login", search: { redirect: destination } });
    if (result.status === "not-found") throw notFound();
    if (result.status === "ready")
      throw redirect({
        to: "/my-events/$eventOccurrenceId/surveys/$eventTemplateVersionItemId",
        params: {
          eventOccurrenceId: result.eventOccurrenceId,
          eventTemplateVersionItemId: result.eventTemplateVersionItemId,
        },
      });
    return result;
  },
  head: () => ({ meta: [{ title: "Event survey — Upskill" }] }),
  component: EventSurveyUnavailablePage,
});

function EventSurveyUnavailablePage() {
  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <div>
          <Text c="indigo.7" fw={700}>
            Event survey
          </Text>
          <Title order={1}>This activity is not open yet</Title>
        </div>
        <Alert title="Survey unavailable">
          Your registration was recognised, but this exact Survey is currently
          locked by the Event schedule. Return to My events to see when the
          Section opens.
        </Alert>
        <Button component={Link} to="/my-events">
          Go to My events
        </Button>
      </Stack>
    </Container>
  );
}
