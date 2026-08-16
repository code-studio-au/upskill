import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { Link, useRouter } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { PageTabs, type PageTab } from "#/features/shared/PageTabs";
import type { LearnerEvent } from "./learner.schema";
import {
  registerLearnerEvent,
  withdrawLearnerEvent,
} from "#/server/functions/learner";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { groupLearnerEvents } from "./learner-event-grouping";
import classes from "./LearnerEventSection.module.css";

type EventView = "registrations" | "available" | "history";

const viewContent: Record<EventView, { title: string; empty: string }> = {
  registrations: {
    title: "My event registrations",
    empty: "You do not have any active event registrations.",
  },
  available: {
    title: "Available events",
    empty: "There are no other events available to you.",
  },
  history: {
    title: "Registration history",
    empty: "You do not have any previous registration outcomes.",
  },
};

function statusLabel(event: LearnerEvent): string {
  if (!event.registrationStatus) {
    if (event.registrationUnavailableReason === "not_open")
      return "Registration opens later";
    if (event.registrationUnavailableReason === "closed")
      return "Registration closed";
    if (event.registrationUnavailableReason === "full") return "Event full";
    return "Registration available";
  }
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

function statusColor(event: LearnerEvent): string {
  if (event.registrationStatus === "selected") return "green";
  if (event.registrationStatus === "coordinator_approved") return "teal";
  if (event.registrationStatus === "waitlisted") return "yellow";
  if (
    event.registrationStatus === "coordinator_declined" ||
    event.registrationStatus === "not_selected" ||
    event.registrationStatus === "withdrawn"
  )
    return "red";
  if (
    event.registrationStatus === "cancelled" ||
    (!event.registrationStatus && !event.canRegister)
  )
    return "gray";
  return "blue";
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
  const grouped = groupLearnerEvents(events);
  const [activeView, setActiveView] = useState<EventView>(() => {
    if (grouped.registrations.length > 0) return "registrations";
    if (grouped.available.length > 0) return "available";
    if (grouped.history.length > 0) return "history";
    return "registrations";
  });
  const tabs: Array<PageTab<EventView>> = [
    {
      value: "registrations",
      label: `My registrations\n(${String(grouped.registrations.length)})`,
    },
    {
      value: "available",
      label: `Available events\n(${String(grouped.available.length)})`,
    },
    {
      value: "history",
      label: `History\n(${String(grouped.history.length)})`,
    },
  ];
  const activeEvents = grouped[activeView];

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
        setActiveView("registrations");
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
        setActiveView("history");
        return;
      }
      setError("This registration can no longer be withdrawn online.");
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <section aria-label="Event lists">
      <Stack gap="lg">
        {error ? <Alert color="red">{error}</Alert> : null}
        <PageTabs
          className={classes.eventTabs}
          label="Event lists"
          value={activeView}
          tabs={tabs}
          onChange={setActiveView}
        />
        <EventGroup
          headingId={`${activeView}-events-heading`}
          title={viewContent[activeView].title}
        >
          {activeEvents.length > 0 ? (
            activeEvents.map((event) => (
              <LearnerEventCard
                key={event.eventOccurrenceId}
                event={event}
                processing={processingId === event.eventOccurrenceId}
                selectedRegion={selectedRegions[event.eventOccurrenceId] ?? ""}
                onRegionChange={(value) => {
                  setSelectedRegions((current) => ({
                    ...current,
                    [event.eventOccurrenceId]: value,
                  }));
                }}
                onRegister={register}
                onWithdraw={withdraw}
              />
            ))
          ) : (
            <Paper withBorder radius="lg" p="md">
              <Text c="dimmed">{viewContent[activeView].empty}</Text>
            </Paper>
          )}
        </EventGroup>
      </Stack>
    </section>
  );
}

function EventGroup({
  headingId,
  title,
  children,
}: {
  headingId: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={headingId}>
      <Stack gap="md">
        <Title order={3} id={headingId}>
          {title}
        </Title>
        {children}
      </Stack>
    </section>
  );
}

function LearnerEventCard({
  event,
  processing,
  selectedRegion,
  onRegionChange,
  onRegister,
  onWithdraw,
}: {
  event: LearnerEvent;
  processing: boolean;
  selectedRegion: string;
  onRegionChange: (value: string) => void;
  onRegister: (
    eventOccurrenceId: string,
    regionId: string | null,
  ) => Promise<void>;
  onWithdraw: (eventOccurrenceId: string) => Promise<void>;
}) {
  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="sm">
        <Group justify="space-between" align="start" wrap="wrap">
          <div>
            <Title order={4}>{event.title}</Title>
            <Text size="sm" c="dimmed">
              {event.eventTemplateTitle}
            </Text>
          </div>
          <Badge color={statusColor(event)} variant="light">
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
        {event.registrationStatus === "selected" ? (
          <Link
            to="/my-events/$eventOccurrenceId"
            params={{ eventOccurrenceId: event.eventOccurrenceId }}
          >
            <Button component="span">Open event</Button>
          </Link>
        ) : null}
        {!event.registrationStatus ? (
          <Stack gap="xs">
            {event.canRegister && event.regions.length > 0 ? (
              <MantineNativeSelect
                label="Your region"
                value={selectedRegion}
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
                  onRegionChange(change.currentTarget.value);
                }}
                required
              />
            ) : null}
            <Button
              disabled={
                !event.canRegister ||
                (event.regions.length > 0 && !selectedRegion)
              }
              loading={processing}
              onClick={() => {
                void onRegister(
                  event.eventOccurrenceId,
                  selectedRegion || null,
                );
              }}
            >
              {unavailableLabel(event)}
            </Button>
          </Stack>
        ) : event.registrationStatus !== "withdrawn" &&
          event.registrationStatus !== "cancelled" &&
          event.registrationStatus !== "not_selected" &&
          event.registrationStatus !== "coordinator_declined" ? (
          <Button
            variant="subtle"
            color="red"
            loading={processing}
            onClick={() => {
              void onWithdraw(event.eventOccurrenceId);
            }}
          >
            Withdraw registration
          </Button>
        ) : null}
      </Stack>
    </Paper>
  );
}
