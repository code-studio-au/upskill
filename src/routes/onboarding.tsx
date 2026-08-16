import { Alert, Button, Container, Stack } from "#/features/shared/mantine";
import { LearnerSurveyExperience } from "#/features/survey/LearnerSurveyExperience";
import {
  getLearnerOnboarding,
  saveOnboardingStep,
} from "#/server/functions/onboarding";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding")({
  ssr: true,
  loader: async () => {
    const result = await getLearnerOnboarding();
    if (result.status === "unauthenticated")
      throw redirect({ to: "/login", search: { redirect: "/onboarding" } });
    if (result.status === "complete" || result.status === "not-configured")
      throw redirect({ to: "/dashboard" });
    return result.data;
  },
  component: OnboardingPage,
});

function OnboardingPage() {
  const onboarding = Route.useLoaderData();
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
          <Stack gap="sm">
            <Button component={Link} to="/dashboard">
              Continue to My learning
            </Button>
          </Stack>
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
