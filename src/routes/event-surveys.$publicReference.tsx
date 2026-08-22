import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { eventSurveyPublicReferenceSchema } from "#/features/event-operations/event-operations.schema";
import { getEventRecoveryLanding } from "#/server/functions/learner";

function routeLocation(publicReference: string, recovery: string): string {
  return `/event-surveys/${encodeURIComponent(publicReference)}?recovery=${encodeURIComponent(recovery)}`;
}

function redirectResponse(location: string, cookies: Array<string> = []) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export const Route = createFileRoute("/event-surveys/$publicReference")({
  validateSearch: (search) => ({
    recovery: typeof search.recovery === "string" ? search.recovery : undefined,
  }),
  ssr: "data-only",
  loader: async ({ params }) => {
    const parsed = eventSurveyPublicReferenceSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getEventRecoveryLanding({ data: parsed.data });
    if (result.status === "not-found") throw notFound();
    if (result.status === "ready")
      throw redirect({
        to: "/my-events/$eventOccurrenceId/surveys/$eventTemplateVersionItemId",
        params: result.data,
      });
    return result;
  },
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { eventRecoveryRequestSchema, eventRecoveryVerificationSchema } =
          await import("#/features/event-recovery/event-recovery.schema");
        const parsedReference =
          eventSurveyPublicReferenceSchema.safeParse(params);
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
        const intent = form.get("intent");
        const recovery =
          await import("#/server/events/event-prerequisite-recovery.server");
        if (intent === "request") {
          const input = eventRecoveryRequestSchema.safeParse({
            publicReference,
            identifier: form.get("identifier"),
          });
          if (!input.success)
            return redirectResponse(routeLocation(publicReference, "invalid"));
          const result = await recovery.requestEventRecoveryCode(input.data);
          if (result.status !== "accepted")
            return redirectResponse(
              routeLocation(publicReference, result.status),
            );
          return redirectResponse(routeLocation(publicReference, "sent"), [
            recovery.eventRecoveryChallengeCookie(result.challengeReference),
          ]);
        }
        const challengeReference =
          recovery.readEventRecoveryChallengeCookie(request);
        const input = eventRecoveryVerificationSchema.safeParse({
          publicReference,
          challengeReference,
          code: form.get("code"),
        });
        if (!input.success)
          return redirectResponse(routeLocation(publicReference, "invalid"));
        const result = await recovery.verifyEventRecoveryCode(input.data);
        if (result.status !== "ready" || !result.taskSessionToken)
          return redirectResponse(
            routeLocation(publicReference, result.status),
          );
        return redirectResponse(
          `/my-events/${encodeURIComponent(result.data.eventOccurrenceId)}/surveys/${encodeURIComponent(result.data.eventTemplateVersionItemId)}`,
          [
            recovery.eventTaskSessionCookie(result.taskSessionToken),
            recovery.clearEventRecoveryChallengeCookie(),
          ],
        );
      },
    },
  },
  head: () => ({
    meta: [
      { title: "Event survey access — Upskill" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: EventSurveyRecoveryPage,
});

function EventSurveyRecoveryPage() {
  const result = Route.useLoaderData();
  const { recovery } = Route.useSearch();
  if (result.status === "unavailable") return <h1>Survey unavailable</h1>;
  const sent = recovery === "sent" || recovery === "invalid";
  return (
    <main id="recovery">
      <h1>{result.data.surveyTitle}</h1>
      <form method="post">
        <input
          type="hidden"
          name="intent"
          value={sent ? "verify" : "request"}
        />
        <label>
          {recovery === "invalid"
            ? "Incorrect code"
            : sent
              ? "6-digit code"
              : "Email or mobile"}
          <input
            name={sent ? "code" : "identifier"}
            type="text"
            autoComplete={sent ? "one-time-code" : "username"}
            required
          />
        </label>
        <button type="submit">
          {recovery === "rate-limited"
            ? "Try later"
            : recovery === "expired"
              ? "Send new code"
              : sent
                ? "Verify"
                : "Send code"}
        </button>
      </form>
    </main>
  );
}
