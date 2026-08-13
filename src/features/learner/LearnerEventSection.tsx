import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
import type { LearnerEvent } from "./learner.schema";
import {
  registerLearnerEvent,
  withdrawLearnerEvent,
} from "#/server/functions/learner";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";

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
  const [selectedRegions, setSelectedRegions] = useState<
    Record<string, string>
  >({});

  async function register(eventOccurrenceId: string, regionId: string | null) {
    setProcessingId(eventOccurrenceId);
    setError(null);
    try {
      const result = await registerLearnerEvent({
        data: {
          eventOccurrenceId,
          eventOccurrenceRegionId: regionId,
        },
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

  async function withdraw(eventOccurrenceId: string) {
    setProcessingId(eventOccurrenceId);
    setError(null);
    try {
      const result = await withdrawLearnerEvent({
        data: { eventOccurrenceId, eventOccurrenceRegionId: null },
      });
      if (result.status === "withdrawn") {
        await router.invalidate();
        return;
      }
      setError("This registration can no longer be withdrawn online.");
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
                <Stack gap="xs">
                  {event.regions.length > 0 ? (
                    <MantineNativeSelect
                      label="Your region"
                      value={selectedRegions[event.eventOccurrenceId] ?? ""}
                      data={[
                        {
                          value: "",
                          label: "Select your region",
                          disabled: true,
                        },
                        ...event.regions.map((region) => ({
                          value: region.id,
                          label: region.name,
                        })),
                      ]}
                      onChange={(change) => {
                        const value = change.currentTarget.value;
                        setSelectedRegions((current) => ({
                          ...current,
                          [event.eventOccurrenceId]: value,
                        }));
                      }}
                      required
                    />
                  ) : null}
                  <Button
                    disabled={
                      !event.canRegister ||
                      (event.regions.length > 0 &&
                        !selectedRegions[event.eventOccurrenceId])
                    }
                    loading={processingId === event.eventOccurrenceId}
                    onClick={() => {
                      void register(
                        event.eventOccurrenceId,
                        selectedRegions[event.eventOccurrenceId] || null,
                      );
                    }}
                  >
                    {unavailableLabel(event)}
                  </Button>
                </Stack>
              ) : event.registrationStatus !== "withdrawn" &&
                event.registrationStatus !== "cancelled" &&
                event.registrationStatus !== "not_selected" ? (
                <Button
                  variant="subtle"
                  color="red"
                  loading={processingId === event.eventOccurrenceId}
                  onClick={() => {
                    void withdraw(event.eventOccurrenceId);
                  }}
                >
                  Withdraw registration
                </Button>
              ) : null}
            </Stack>
          </Paper>
        ))}
      </Stack>
    </section>
  );
}
