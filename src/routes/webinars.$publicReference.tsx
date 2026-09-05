import { useEffect } from "react";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { eventVirtualLobbyReferenceSchema } from "#/features/event-lobby/event-virtual-lobby.schema";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { Button } from "#/features/shared/mantine";
import { getEventVirtualLobby } from "#/server/functions/event-virtual-lobby";
import classes from "./webinars.$publicReference.module.css";

const recoveryStatuses = new Set([
  "sent",
  "request-invalid",
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
            await import("#/features/event-lobby/event-virtual-recovery.schema")
          ).eventVirtualRecoveryRequestSchema.safeParse({
            publicReference,
            identifier: form.get("identifier"),
          });
          if (!input.success)
            return redirectResponse(
              routeLocation(publicReference, "request-invalid"),
            );
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
          await import("#/features/event-lobby/event-virtual-recovery.schema")
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
  component: EventVirtualLobbyPage,
});

function EventVirtualLobbyPage() {
  const data = Route.useLoaderData();
  const { recovery } = Route.useSearch();
  const router = useRouter();
  useEffect(() => {
    const pollAfterMilliseconds = data.pollAfterMilliseconds;
    if (!pollAfterMilliseconds) return;
    let stopped = false;
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          if (document.visibilityState === "visible") void router.invalidate();
          if (!stopped) schedule();
        },
        pollAfterMilliseconds * (0.75 + Math.random() * 0.5),
      );
    };
    schedule();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [data.pollAfterMilliseconds, router]);

  const codeSent = recovery === "sent" || recovery === "invalid";
  return (
    <main className={classes.page}>
      <article className={classes.card}>
        <header>
          <h1>{data.sessionTitle}</h1>
          <p>{data.eventTitle}</p>
          <p>Starts {data.startsAtLabel}</p>
        </header>
        <section className={classes.alert} data-tone={data.presentation.tone}>
          <h2>{data.presentation.title}</h2>
          <p>{data.presentation.message}</p>
        </section>
        {data.outcome === "authentication_required" ? (
          <>
            {recovery ? (
              <p
                className={classes.alert}
                data-tone={
                  recovery === "sent"
                    ? "blue"
                    : recovery === "rate-limited"
                      ? "orange"
                      : "red"
                }
              >
                {recovery === "sent"
                  ? "Code sent. Enter the 6-digit code below."
                  : "Check the code or details."}
              </p>
            ) : null}
            <form method="post">
              <MantineTextInput
                name={codeSent ? "code" : "identifier"}
                label={codeSent ? "6-digit code" : "Verified email or mobile"}
                autoComplete={codeSent ? "one-time-code" : "username"}
                {...(codeSent ? { inputMode: "numeric" as const } : {})}
                required
              />
              <div>
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
            </form>
          </>
        ) : null}
        {data.outcome === "questionnaire_required" && data.questionnaireUrl ? (
          <Button component="a" href={data.questionnaireUrl}>
            Complete registration
          </Button>
        ) : null}
        {data.outcome === "recording_acknowledgement_required" ? (
          <form method="post">
            <Button name="intent" value="acknowledge" type="submit">
              Acknowledge and continue
            </Button>
          </form>
        ) : null}
      </article>
    </main>
  );
}
