import { createFileRoute, notFound } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import {
  eventGuestReferenceSchema,
  eventGuestSubmissionSchema,
  type EventGuestSubmissionResult,
} from "#/features/event-guest/event-guest.schema";
import { firstFormError } from "#/features/shared/form-errors";
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
  const [submission, setSubmission] =
    useState<EventGuestSubmissionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      publicReference,
      name: "",
      email: "",
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
      <Container size="sm" py="xl">
        <Alert title={result.title} color="blue">
          {result.reason === "not-open"
            ? "Event access is not open yet."
            : result.reason === "closed"
              ? "Event access has closed."
              : "This event is no longer available."}
        </Alert>
      </Container>
    );

  if (submission?.status === "ready") {
    const details = submission.data;
    return (
      <Container size="sm" py="xl">
        <Paper withBorder radius="lg" p={{ base: "md", sm: "xl" }}>
          <Stack gap="lg">
            <div>
              <Text c="indigo.7" fw={700}>
                Event access
              </Text>
              <Title order={1}>{details.eventTitle}</Title>
            </div>
            {details.attendanceState === "checked_in" ? (
              <Alert color="green">
                You are checked in. Event staff will confirm attendance.
              </Alert>
            ) : details.attendanceState === "attended" ? (
              <Alert color="green">Your attendance has been recorded.</Alert>
            ) : (
              <Alert color="blue">
                Your details have been recorded. Attendance opens during the
                scheduled session.
              </Alert>
            )}
            {details.deliveryMode === "virtual" && details.destinationUrl ? (
              <Button
                component="a"
                href={details.destinationUrl}
                target="_blank"
                rel="noreferrer"
                size="lg"
              >
                Join virtual event
              </Button>
            ) : (
              <Stack gap="xs">
                {details.venueName ? (
                  <Text fw={700}>{details.venueName}</Text>
                ) : null}
                {details.venueAddress ? (
                  <Text>{details.venueAddress}</Text>
                ) : null}
              </Stack>
            )}
            {details.accountSetupRequested ? (
              <Text size="sm">
                Check your email to finish setting up your Upskill account.
              </Text>
            ) : null}
          </Stack>
        </Paper>
      </Container>
    );
  }

  return (
    <Container size="sm" py="xl">
      <Paper withBorder radius="lg" p={{ base: "md", sm: "xl" }}>
        <Stack gap="lg">
          <div>
            <Text c="indigo.7" fw={700}>
              Event access
            </Text>
            <Title order={1}>{result.data.title}</Title>
            <Text mt="xs">
              {formatLocalDateTime(result.data.startsAt, {
                timeZone: result.data.timezone,
              })}
            </Text>
          </div>
          {error ? <Alert color="red">{error}</Alert> : null}
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
                <form.Field name="privacyAccepted">
                  {(field) => (
                    <div>
                      <MantineCheckbox
                        checked={field.state.value}
                        onChange={field.handleChange}
                        label="I agree that my name, email and event activity may be recorded for event administration and learning records."
                      />
                      {firstFormError(field.state.meta.errors) ? (
                        <Text c="red" size="sm">
                          You must accept the privacy notice to continue.
                        </Text>
                      ) : null}
                    </div>
                  )}
                </form.Field>
                <Button type="submit" size="lg" loading={isSubmitting}>
                  Continue to event
                </Button>
              </form>
            )}
          </form.Subscribe>
        </Stack>
      </Paper>
    </Container>
  );
}
