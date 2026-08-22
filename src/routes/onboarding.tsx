import type { LearnerOnboarding } from "#/features/onboarding/onboarding.schema";
import { Alert, Button, Container } from "#/features/shared/mantine";
import { LearnerSurveyExperience } from "#/features/survey/LearnerSurveyExperience";
import {
  getLearnerOnboarding,
  saveOnboardingStep,
} from "#/server/functions/onboarding";
import { createFileRoute, redirect } from "@tanstack/react-router";

function onboardingLocation(status: string): string {
  return `/onboarding?verification=${encodeURIComponent(status)}`;
}

function verificationMessage(status: string): string {
  if (status === "sent") return "Code sent.";
  if (status === "verified") return "Verified.";
  if (status === "invalid") return "Incorrect code.";
  if (status === "expired") return "Code expired. Send a new code.";
  if (status === "rate-limited") return "Try again later.";
  return "Verification unavailable.";
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

export const Route = createFileRoute("/onboarding")({
  validateSearch: (search) => ({
    verification:
      typeof search.verification === "string" ? search.verification : undefined,
  }),
  ssr: true,
  loader: async () => {
    const result = await getLearnerOnboarding();
    if (result.status === "unauthenticated")
      throw redirect({ to: "/login", search: { redirect: "/onboarding" } });
    if (result.status === "complete" || result.status === "not-configured")
      throw redirect({ to: "/dashboard" });
    return result.data;
  },
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getServerEnv } = await import("#/server/env.server");
        if (
          request.headers.get("origin") !==
          new URL(getServerEnv().APP_ORIGIN).origin
        )
          return new Response(null, { status: 403 });
        const { getRequestUser } = await import("#/server/auth/session.server");
        const user = await getRequestUser();
        if (!user) return new Response(null, { status: 401 });
        const form = await request.formData();
        const intent = form.get("intent");
        const contracts =
          await import("#/features/onboarding/onboarding.schema");
        const verification =
          await import("#/server/onboarding/onboarding-contact-verification.server");
        if (intent === "request") {
          const input = contracts.onboardingVerificationRequestSchema.safeParse(
            {
              assignmentId: form.get("assignmentId"),
              channel: form.get("channel"),
            },
          );
          if (!input.success)
            return redirectResponse(onboardingLocation("unavailable"));
          const result =
            await verification.requestOnboardingContactVerification(
              input.data,
              user,
            );
          if (result.status !== "sent")
            return redirectResponse(
              onboardingLocation(verificationMessage(result.status)),
            );
          return redirectResponse(
            onboardingLocation(verificationMessage("sent")),
            [
              verification.onboardingVerificationChallengeCookie(
                result.challengeReference,
              ),
            ],
          );
        }
        if (intent === "skip") {
          const input = contracts.onboardingVerificationSkipSchema.safeParse({
            assignmentId: form.get("assignmentId"),
          });
          if (!input.success)
            return redirectResponse(onboardingLocation("unavailable"));
          const result = await verification.skipOnboardingContactVerification(
            input.data.assignmentId,
            user,
          );
          return redirectResponse(
            result === "skipped" ? "/dashboard" : onboardingLocation(result),
            [verification.clearOnboardingVerificationChallengeCookie()],
          );
        }
        const challengeReference =
          verification.readOnboardingVerificationChallengeCookie(request);
        const input = contracts.onboardingVerificationCodeSchema.safeParse({
          assignmentId: form.get("assignmentId"),
          code: form.get("code"),
        });
        if (!input.success || !challengeReference)
          return redirectResponse(onboardingLocation("invalid"));
        const result = await verification.verifyOnboardingContactCode(
          { ...input.data, challengeReference },
          user,
        );
        if (result.status !== "verified")
          return redirectResponse(
            onboardingLocation(verificationMessage(result.status)),
          );
        return redirectResponse(
          result.complete
            ? "/dashboard"
            : onboardingLocation(verificationMessage("verified")),
          [verification.clearOnboardingVerificationChallengeCookie()],
        );
      },
    },
  },
  component: OnboardingPage,
});

function OnboardingPage() {
  const onboarding = Route.useLoaderData();
  const { verification } = Route.useSearch();
  if (onboarding.submittedAt)
    return (
      <ContactVerification
        assignmentId={onboarding.assignmentId}
        state={onboarding.verification}
        status={verification}
      />
    );
  return (
    <>
      <Container size="sm" py="xl">
        <Alert title={`Privacy notice ${onboarding.privacyNoticeVersion}`}>
          {onboarding.privacyNotice}
        </Alert>
      </Container>
      <LearnerSurveyExperience
        survey={{
          sectionTitle: "Account setup",
          content: onboarding.content,
          progress: onboarding.progress,
          submittedAt: onboarding.submittedAt,
        }}
        completionDescription="Your profile is ready."
        returnAction={
          <Button component="a" href="/onboarding">
            Continue
          </Button>
        }
        onAdvance={(itemId, answer) =>
          saveOnboardingStep({
            data: { assignmentId: onboarding.assignmentId, itemId, answer },
          })
        }
      />
    </>
  );
}

function ContactVerification({
  assignmentId,
  state,
  status,
}: {
  assignmentId: string;
  state: LearnerOnboarding["verification"];
  status: string | undefined;
}) {
  const enteringCode = status === "Code sent." || status === "Incorrect code.";
  const channel =
    state.email.enabled && !state.email.verified ? "email" : "sms";
  const contact = state[channel];
  return (
    <main id="recovery">
      <h1>Verify contact</h1>
      <p>Recommended. Codes expire in 10 minutes.</p>
      {status ? <p role="alert">{status}</p> : null}
      <form method="post">
        <input type="hidden" name="assignmentId" value={assignmentId} />
        {enteringCode ? (
          <>
            <label>
              6-digit verification code
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
              />
            </label>
            <button type="submit" name="intent" value="verify">
              Verify code
            </button>
          </>
        ) : (
          <>
            <p>{contact.destination ?? "Mobile unavailable"}</p>
            <input type="hidden" name="channel" value={channel} />
            {contact.destination ? (
              <button type="submit" name="intent" value="request">
                Send {channel === "email" ? "email" : "SMS"} code
              </button>
            ) : null}
          </>
        )}
        {!state.required ? (
          <button type="submit" name="intent" value="skip" formNoValidate>
            Skip for now
          </button>
        ) : (
          <p>Required to continue.</p>
        )}
      </form>
    </main>
  );
}
