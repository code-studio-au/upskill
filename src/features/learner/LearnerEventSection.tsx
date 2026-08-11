import { Alert, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
import type { LearnerEvent } from "./learner.schema";
import { registerLearnerEvent } from "#/server/functions/learner";

function statusLabel(event: LearnerEvent): string {
  if (!event.registrationStatus) return "Registration available";
  const labels = {
    submitted: "Registration submitted",
    coordinator_approved: "Coordinator approved",
    coordinator_declined: "Registration declined",
    selected: "Registration confirmed",
    waitlisted: "Waitlisted",
    not_selected: "Not selected",
    withdrawn: "Withdrawn",
    cancelled: "Cancelled",
  } as const;
  return labels[event.registrationStatus];
}

function unavailableLabel(event: LearnerEvent): string {
  if (event.registrationUnavailableReason === "not_open")
    return "Registration not open";
  if (event.registrationUnavailableReason === "closed")
    return "Registration closed";
  if (event.registrationUnavailableReason === "full") return "Event full";
  return "Register";
}

export function LearnerEventSection({
  events,
}: {
  events: Array<LearnerEvent>;
}) {
  const router = useRouter();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function register(eventOccurrenceId: string) {
    setProcessingId(eventOccurrenceId);
    setError(null);
    try {
      const result = await registerLearnerEvent({
        data: { eventOccurrenceId },
      });
      if (
        result.status === "registered" ||
        result.status === "already-registered"
      ) {
        await router.invalidate();
        return;
      }
      setError(
        result.status === "ineligible"
          ? "Your verified email address is not eligible for this event."
          : "Registration is not currently available for this event.",
      );
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <section aria-labelledby="available-events-heading">
      <Stack gap="md">
        <div>
          <Title order={2} id="available-events-heading">
            Events
          </Title>
          <Text c="dimmed">
            Register for upcoming instructor-led learning and track your
            approval.
          </Text>
        </div>
        {error ? <Alert color="red">{error}</Alert> : null}
        {events.map((event) => (
          <Paper key={event.eventOccurrenceId} withBorder radius="lg" p="lg">
            <Stack gap="sm">
              <Group justify="space-between" align="start" wrap="wrap">
                <div>
                  <Title order={3}>{event.title}</Title>
                  <Text size="sm" c="dimmed">
                    {event.eventTemplateTitle}
                  </Text>
                </div>
                <Badge
                  color={
                    event.registrationStatus === "selected" ? "green" : "blue"
                  }
                  variant="light"
                >
                  {statusLabel(event)}
                </Badge>
              </Group>
              <Text size="sm">
                {formatLocalDateTime(event.startsAt, {
                  timeZone: event.timezone,
                })}
                {" – "}
                {formatLocalDateTime(event.endsAt, {
                  timeZone: event.timezone,
                })}
              </Text>
              <Text size="sm" c="dimmed">
                {event.deliveryMode === "virtual" ? "Virtual" : "In person"} ·{" "}
                {event.timezone}
              </Text>
              {!event.registrationStatus ? (
                <Button
                  disabled={!event.canRegister}
                  loading={processingId === event.eventOccurrenceId}
                  onClick={() => {
                    void register(event.eventOccurrenceId);
                  }}
                >
                  {unavailableLabel(event)}
                </Button>
              ) : null}
            </Stack>
          </Paper>
        ))}
      </Stack>
    </section>
  );
}
