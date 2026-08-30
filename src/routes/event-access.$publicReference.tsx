import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import {
  eventGuestReferenceSchema,
  eventGuestSubmissionSchema,
  type EventGuestSubmissionResult,
} from "#/features/event-guest/event-guest.schema";
import { firstFormError } from "#/features/shared/form-errors";
import { Badge } from "#/features/shared/Badge";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import {
  Alert,
  Button,
  Container,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { formatLocalDateTime } from "#/features/shared/local-date";
import {
  getPublicEventGuestAccess,
  submitPublicEventGuestAccess,
} from "#/server/functions/event-guest";
import classes from "./event-access.$publicReference.module.css";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/event-access/$publicReference")({
  ssr: "data-only",
  loader: async ({ params }) => {
    const parsed = eventGuestReferenceSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getPublicEventGuestAccess({ data: parsed.data });
    if (result.status === "not-found") throw notFound();
    return result;
  },
  head: () => ({
    meta: [
      { title: "Event access — Upskill" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: EventGuestAccessPage,
});

function EventGuestAccessPage() {
  const result = Route.useLoaderData();
  const { publicReference } = Route.useParams();
  const appShell = rootRoute.useLoaderData();
  const [submission, setSubmission] =
    useState<EventGuestSubmissionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      publicReference,
      name: appShell.user?.name ?? "",
      email: appShell.user?.email ?? "",
      privacyAccepted: false,
    },
    validators: { onSubmit: eventGuestSubmissionSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      const response = await submitPublicEventGuestAccess({
        data: value,
      });
      if (response.status === "ready") setSubmission(response);
      else
        setError(
          response.status === "rate-limited"
            ? "Too many attempts were made from this connection. Try again in 15 minutes."
            : "Event access is no longer available.",
        );
    },
  });

  if (result.status === "unavailable")
    return (
      <div className={classes.page}>
        <Container size="sm" className={classes.shell}>
          <Paper
            withBorder
            radius="lg"
            p={{ base: "lg", sm: "xl" }}
            className={classes.unavailableCard}
          >
            <Stack gap="lg">
              <Badge color="blue" w="fit-content">
                Event access
              </Badge>
              <div>
                <Title order={1} className={classes.unavailableTitle}>
                  {result.title}
                </Title>
                <Text c="dimmed" mt="xs">
                  This access link is for an open-entry Upskill event.
                </Text>
              </div>
              <Alert title="Access unavailable" color="blue" role="status">
                {result.reason === "not-open"
                  ? "Event access is not open yet. Please try again closer to the event."
                  : result.reason === "closed"
                    ? "Event access has closed because the event has finished."
                    : "This event is no longer available."}
              </Alert>
            </Stack>
          </Paper>
        </Container>
      </div>
    );

  if (submission?.status === "ready") {
    const details = submission.data;
    return (
      <div className={classes.page}>
        <Container className={classes.shell}>
          <Paper withBorder radius="lg" className={classes.card}>
            <div className={classes.layout}>
              <section
                className={classes.eventPanel}
                aria-label="Event access confirmed"
              >
                <Stack gap="lg">
                  <Badge color="green" w="fit-content">
                    Access confirmed
                  </Badge>
                  <div>
                    <Text className={classes.eyebrow} fw={700}>
                      Upskill event
                    </Text>
                    <Title order={1} className={classes.eventTitle}>
                      {details.eventTitle}
                    </Title>
                  </div>
                  <Text className={classes.panelCopy}>
                    Your details have been securely recorded for this event.
                  </Text>
                </Stack>
              </section>
              <section
                className={classes.actionPanel}
                aria-labelledby="access-next-step"
              >
                <Stack gap="lg">
                  <div>
                    <Title order={2} id="access-next-step">
                      You’re ready to continue
                    </Title>
                    <Text c="dimmed" mt="xs">
                      Use the event details below for your next step.
                    </Text>
                  </div>
                  {details.attendanceState === "checked_in" ? (
                    <Alert
                      color="green"
                      title="Check-in recorded"
                      role="status"
                    >
                      Event staff will confirm your attendance.
                    </Alert>
                  ) : details.attendanceState === "attended" ? (
                    <Alert
                      color="green"
                      title="Attendance recorded"
                      role="status"
                    >
                      Your attendance has been recorded.
                    </Alert>
                  ) : (
                    <Alert color="blue" title="Details recorded" role="status">
                      Attendance opens during the scheduled session.
                    </Alert>
                  )}
                  {details.deliveryMode === "virtual" &&
                  details.destinationUrl ? (
                    <Button
                      component="a"
                      href={details.destinationUrl}
                      target="_blank"
                      rel="noreferrer"
                      size="lg"
                      fullWidth
                    >
                      Join virtual event
                    </Button>
                  ) : details.deliveryMode === "in_person" ? (
                    <div className={classes.destination}>
                      <Text size="sm" c="dimmed" fw={700}>
                        Event location
                      </Text>
                      {details.venueName ? (
                        <Text fw={700}>{details.venueName}</Text>
                      ) : null}
                      {details.venueAddress ? (
                        <Text>{details.venueAddress}</Text>
                      ) : (
                        <Text c="dimmed">
                          Event staff will provide the venue details.
                        </Text>
                      )}
                    </div>
                  ) : (
                    <Alert color="blue">
                      The virtual meeting link is not available yet.
                    </Alert>
                  )}
                  {details.accountSetupRequested ? (
                    <Alert color="blue" title="Set up your Upskill account">
                      Check your email for a secure account setup link.
                    </Alert>
                  ) : null}
                </Stack>
              </section>
            </div>
          </Paper>
        </Container>
      </div>
    );
  }

  return (
    <div className={classes.page}>
      <Container className={classes.shell}>
        <Paper withBorder radius="lg" className={classes.card}>
          <div className={classes.layout}>
            <section className={classes.eventPanel} aria-label="Event details">
              <Stack gap="lg">
                <Badge color="blue" w="fit-content">
                  {result.data.deliveryMode === "virtual"
                    ? "Virtual event"
                    : "In-person event"}
                </Badge>
                <div>
                  <Text className={classes.eyebrow} fw={700}>
                    Open event access
                  </Text>
                  <Title order={1} className={classes.eventTitle}>
                    {result.data.title}
                  </Title>
                </div>
                <dl className={classes.eventFacts}>
                  <div>
                    <dt>Starts</dt>
                    <dd>
                      {formatLocalDateTime(result.data.startsAt, {
                        timeZone: result.data.timezone,
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt>Ends</dt>
                    <dd>
                      {formatLocalDateTime(result.data.endsAt, {
                        timeZone: result.data.timezone,
                      })}
                    </dd>
                  </div>
                </dl>
                <Text className={classes.timezone} size="sm">
                  Times shown in {result.data.timezone.replaceAll("_", " ")}
                </Text>
              </Stack>
            </section>
            <section
              className={classes.actionPanel}
              aria-labelledby="event-access-heading"
            >
              <Stack gap="lg">
                <div>
                  <Title order={2} id="event-access-heading">
                    Access this event
                  </Title>
                  <Text c="dimmed" mt="xs">
                    Enter your details to continue. If a session is underway,
                    your check-in will be recorded automatically.
                  </Text>
                </div>
                {error ? (
                  <Alert color="red" title="Could not continue" role="alert">
                    {error}
                  </Alert>
                ) : null}
                <form.Subscribe selector={(state) => state.isSubmitting}>
                  {(isSubmitting) => (
                    <form
                      className={classes.form}
                      onSubmit={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void form.handleSubmit();
                      }}
                    >
                      <div className={classes.fieldGrid}>
                        <form.Field name="name">
                          {(field) => (
                            <MantineTextInput
                              label="Full name"
                              autoComplete="name"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) => {
                                field.handleChange(event.currentTarget.value);
                              }}
                              error={firstFormError(field.state.meta.errors)}
                              required
                            />
                          )}
                        </form.Field>
                        <form.Field name="email">
                          {(field) => (
                            <MantineTextInput
                              label="Email address"
                              type="email"
                              inputMode="email"
                              autoComplete="email"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) => {
                                field.handleChange(event.currentTarget.value);
                              }}
                              error={firstFormError(field.state.meta.errors)}
                              required
                            />
                          )}
                        </form.Field>
                      </div>
                      <form.Field name="privacyAccepted">
                        {(field) => (
                          <div className={classes.privacyNotice}>
                            <MantineCheckbox
                              checked={field.state.value}
                              onChange={field.handleChange}
                              label="I agree that my name, email and event activity may be recorded for event administration and learning records."
                            />
                            {firstFormError(field.state.meta.errors) ? (
                              <Text c="red" size="sm" role="alert">
                                You must accept the privacy notice to continue.
                              </Text>
                            ) : null}
                          </div>
                        )}
                      </form.Field>
                      <Button
                        type="submit"
                        size="lg"
                        loading={isSubmitting}
                        fullWidth
                      >
                        Continue to event
                      </Button>
                      <Text c="dimmed" size="xs" className={classes.secureNote}>
                        Your details are only used for event administration and
                        your Upskill learning record.
                      </Text>
                    </form>
                  )}
                </form.Subscribe>
              </Stack>
            </section>
          </div>
        </Paper>
      </Container>
    </div>
  );
}
