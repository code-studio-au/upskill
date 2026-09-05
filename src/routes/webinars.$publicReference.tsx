import { useEffect } from "react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import {
  eventVirtualLobbyReferenceSchema,
  type EventVirtualLobbyOutcome,
} from "#/features/event-lobby/event-virtual-lobby.schema";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
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
import { getEventVirtualLobby } from "#/server/functions/event-virtual-lobby";
import classes from "./webinars.$publicReference.module.css";

const recoveryStatuses = new Set([
  "sent",
  "invalid",
  "expired",
  "rate-limited",
  "unavailable",
]);

function routeLocation(publicReference: string, recovery?: string): string {
  const route = `/webinars/${encodeURIComponent(publicReference)}`;
  return recovery ? `${route}?recovery=${encodeURIComponent(recovery)}` : route;
}

function redirectResponse(location: string, cookies: Array<string> = []) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "private, no-store",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export const Route = createFileRoute("/webinars/$publicReference")({
  validateSearch: (search) => ({
    recovery:
      typeof search.recovery === "string" &&
      recoveryStatuses.has(search.recovery)
        ? search.recovery
        : undefined,
  }),
  ssr: "data-only",
  loader: async ({ params }) => {
    const parsed = eventVirtualLobbyReferenceSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getEventVirtualLobby({ data: parsed.data });
    if (result.status === "not-found") throw notFound();
    return result.data;
  },
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const parsedReference =
          eventVirtualLobbyReferenceSchema.safeParse(params);
        if (!parsedReference.success)
          return new Response(null, { status: 404 });
        const { publicReference } = parsedReference.data;
        const { getServerEnv } = await import("#/server/env.server");
        if (
          request.headers.get("origin") !==
          new URL(getServerEnv().APP_ORIGIN).origin
        )
          return new Response(null, { status: 403 });
        const form = await request.formData();
        if (form.has("login"))
          return redirectResponse(
            `/login?redirect=${encodeURIComponent(routeLocation(publicReference))}`,
          );
        const recovery =
          await import("#/server/events/event-virtual-lobby.server");
        const intent = form.get("intent");
        if (intent === "credential") {
          const { getRequestUser } =
            await import("#/server/auth/session.server");
          const result = await recovery.issueEventVirtualAttendeeCredential(
            publicReference,
            await getRequestUser(),
          );
          return Response.json(result, {
            status:
              result.status === "ready"
                ? 200
                : result.status === "unauthenticated"
                  ? 401
                  : result.status === "not-found"
                    ? 404
                    : 409,
            headers: {
              "Cache-Control": "private, no-store",
              Pragma: "no-cache",
              "Referrer-Policy": "no-referrer",
            },
          });
        }
        if (intent === "acknowledge") {
          const { getRequestUser } =
            await import("#/server/auth/session.server");
          const result = await recovery.acknowledgeEventVirtualRecording(
            publicReference,
            await getRequestUser(),
          );
          return redirectResponse(
            routeLocation(
              publicReference,
              result.status === "ready" ? undefined : "unavailable",
            ),
          );
        }
        if (intent === "request") {
          const input = (
            await import("#/features/event-lobby/event-virtual-lobby.schema")
          ).eventVirtualRecoveryRequestSchema.safeParse({
            publicReference,
            identifier: form.get("identifier"),
          });
          if (!input.success)
            return redirectResponse(routeLocation(publicReference, "invalid"));
          const result = await recovery.requestEventVirtualRecoveryCode(
            input.data,
          );
          if (result.status !== "accepted")
            return redirectResponse(
              routeLocation(publicReference, result.status),
            );
          return redirectResponse(routeLocation(publicReference, "sent"), [
            recovery.eventVirtualChallengeCookie(result.challengeReference),
          ]);
        }
        const challengeReference =
          recovery.readEventVirtualChallengeCookie(request);
        const input = (
          await import("#/features/event-lobby/event-virtual-lobby.schema")
        ).eventVirtualRecoveryVerificationSchema.safeParse({
          publicReference,
          challengeReference,
          code: form.get("code"),
        });
        if (!input.success)
          return redirectResponse(routeLocation(publicReference, "invalid"));
        const result = await recovery.verifyEventVirtualRecoveryCode(
          input.data,
        );
        if (result.status !== "ready" || !result.joinSessionToken)
          return redirectResponse(
            routeLocation(publicReference, result.status),
          );
        return redirectResponse(routeLocation(publicReference), [
          recovery.eventVirtualJoinSessionCookie(result.joinSessionToken),
          recovery.clearEventVirtualChallengeCookie(),
        ]);
      },
    },
  },
  head: () => ({
    meta: [
      { title: "Webinar waiting room — Upskill" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: EventVirtualLobbyPage,
});

function outcomeContent(outcome: EventVirtualLobbyOutcome) {
  if (outcome === "meeting_not_started")
    return {
      title: "The webinar has not started",
      message:
        "You are in the waiting room. This page will update when the presenter opens the webinar.",
      color: "blue" as const,
    };
  if (outcome === "waiting_for_admission")
    return {
      title: "Waiting for admission",
      message:
        "A presenter can see that you are waiting. Keep this page open and you will be admitted here.",
      color: "blue" as const,
    };
  if (outcome === "ready_to_join")
    return {
      title: "Ready to join",
      message:
        "You have been admitted. The webinar player will open here when media delivery is enabled.",
      color: "green" as const,
    };
  if (outcome === "locked")
    return {
      title: "The webinar doors are locked",
      message:
        "The presenter has temporarily stopped new joins. This page will update if the doors reopen.",
      color: "orange" as const,
    };
  if (outcome === "ended")
    return {
      title: "The webinar has ended",
      message: "This webinar is no longer accepting attendees.",
      color: "gray" as const,
    };
  if (outcome === "declined")
    return {
      title: "Admission was declined",
      message: "Contact the event organiser if you believe this is incorrect.",
      color: "red" as const,
    };
  if (outcome === "revoked")
    return {
      title: "Webinar access is unavailable",
      message:
        "Your registration or this join link is no longer eligible for this webinar.",
      color: "red" as const,
    };
  if (outcome === "provider_unavailable")
    return {
      title: "The webinar is temporarily unavailable",
      message:
        "You remain admitted. Keep this page open while the connection is restored.",
      color: "orange" as const,
    };
  return null;
}

function EventVirtualLobbyPage() {
  const data = Route.useLoaderData();
  const { recovery } = Route.useSearch();
  const router = useRouter();
  useEffect(() => {
    if (!data.pollAfterMilliseconds) return;
    const pollAfterMilliseconds = data.pollAfterMilliseconds;
    let cancelled = false;
    let timer: number;
    const schedule = () => {
      if (cancelled) return;
      window.clearTimeout(timer);
      const delay =
        document.visibilityState === "visible"
          ? pollAfterMilliseconds
          : Math.max(15_000, pollAfterMilliseconds);
      timer = window.setTimeout(() => {
        void router.invalidate().then(schedule, schedule);
      }, delay);
    };
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", schedule);
      window.clearTimeout(timer);
    };
  }, [data.pollAfterMilliseconds, router]);

  const content = outcomeContent(data.outcome);
  const codeSent = recovery === "sent" || recovery === "invalid";
  return (
    <main className={classes.page}>
      <Container size="sm">
        <Paper withBorder radius="lg" p="xl">
          <Stack gap="lg">
            <div>
              <Text c="dimmed" size="sm" fw={700}>
                Webinar waiting room
              </Text>
              <Title order={1} className={classes.heading}>
                {data.sessionTitle}
              </Title>
              <Text>{data.eventTitle}</Text>
            </div>
            <div className={classes.details}>
              <Text>
                Starts{" "}
                {formatLocalDateTime(data.startsAt, {
                  timeZone: data.timezone,
                })}
              </Text>
              <Text c="dimmed" size="sm">
                You will not enter the webinar until it has started and you have
                been admitted.
              </Text>
            </div>

            {data.outcome === "authentication_required" ? (
              <Stack gap="md">
                <Alert color="blue" title="Verify your registration">
                  Sign in, or request a short-lived code using the verified
                  email or mobile number on your Upskill profile.
                </Alert>
                {recovery ? (
                  <Alert
                    color={
                      recovery === "sent"
                        ? "blue"
                        : recovery === "rate-limited"
                          ? "orange"
                          : "red"
                    }
                  >
                    {recovery === "sent"
                      ? "Code sent. Enter the 6-digit code below."
                      : recovery === "invalid"
                        ? "That code was incorrect. Try again."
                        : recovery === "expired"
                          ? "That code expired. Request a new one."
                          : recovery === "rate-limited"
                            ? "Too many attempts were made. Try again later."
                            : "Recovery is temporarily unavailable."}
                  </Alert>
                ) : null}
                <form method="post">
                  <Stack gap="sm">
                    <MantineTextInput
                      name={codeSent ? "code" : "identifier"}
                      label={
                        codeSent ? "6-digit code" : "Verified email or mobile"
                      }
                      autoComplete={codeSent ? "one-time-code" : "username"}
                      {...(codeSent ? { inputMode: "numeric" as const } : {})}
                      required
                    />
                    <div className={classes.actions}>
                      <Button
                        name="intent"
                        value={codeSent ? "verify" : "request"}
                        type="submit"
                      >
                        {codeSent ? "Verify code" : "Send code"}
                      </Button>
                      <Button
                        name="login"
                        type="submit"
                        variant="light"
                        formNoValidate
                      >
                        Sign in with password
                      </Button>
                    </div>
                  </Stack>
                </form>
              </Stack>
            ) : data.outcome === "questionnaire_required" ? (
              <Stack gap="md">
                <Alert color="orange" title="Registration details required">
                  Complete the registration questions before entering this
                  webinar waiting room.
                </Alert>
                {data.questionnaireUrl ? (
                  <Button component="a" href={data.questionnaireUrl}>
                    Complete registration
                  </Button>
                ) : null}
              </Stack>
            ) : data.outcome === "recording_acknowledgement_required" ? (
              <Stack gap="md">
                <Alert color="blue" title="Recording notice">
                  {data.recording.notice}
                </Alert>
                <form method="post">
                  <Button name="intent" value="acknowledge" type="submit">
                    Acknowledge and continue
                  </Button>
                </form>
              </Stack>
            ) : content ? (
              <Alert color={content.color} title={content.title}>
                {content.message}
              </Alert>
            ) : null}
          </Stack>
        </Paper>
      </Container>
    </main>
  );
}
