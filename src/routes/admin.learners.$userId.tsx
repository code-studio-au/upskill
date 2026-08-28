import { Badge } from "#/features/shared/Badge";
import { formatLocalDate } from "#/features/shared/local-date";
import {
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { MantineProgress } from "#/features/shared/MantineProgress";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { adminLearnerParamsSchema } from "#/features/admin/admin.schema";
import {
  getAdminLearnerProfile,
  requireAdminReOnboarding,
} from "#/server/functions/admin";
import classes from "./admin.module.css";

const AdminLearnerEventHistory = lazy(async () => {
  const module = await import("#/features/admin/AdminLearnerEventHistory");
  return { default: module.AdminLearnerEventHistory };
});

export const Route = createFileRoute("/admin/learners/$userId")({
  ssr: false,
  loader: async ({ params }) => {
    const parsed = adminLearnerParamsSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getAdminLearnerProfile({ data: parsed.data });
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: {
          redirect: `/admin/learners/${encodeURIComponent(parsed.data.userId)}`,
        },
      });
    if (result.status === "not-found") throw notFound();
    return result;
  },
  component: AdminLearnerProfilePage,
});

function AdminLearnerProfilePage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const [confirmReOnboarding, setConfirmReOnboarding] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  if (result.status === "forbidden") return <AdminAccessDenied />;
  const profile = result.data;

  return (
    <Stack gap="xl">
      <div className={classes.profileHeader}>
        <div>
          <Text c="indigo.7" fw={700}>
            Learner profile
          </Text>
          <Title order={1}>{profile.learner.name}</Title>
          <Text c="dimmed" mt="xs">
            {profile.learner.email}
          </Text>
          <Text c="dimmed" size="sm">
            Email: {profile.learner.emailEnabled ? "enabled" : "disabled"},{" "}
            {profile.learner.emailVerified ? "verified" : "unverified"} · SMS:{" "}
            {profile.learner.smsEnabled ? "enabled" : "disabled"},{" "}
            {profile.learner.smsVerifiedAt ? "verified" : "unverified"} ·{" "}
            {profile.learner.phone ?? "No mobile number"}
          </Text>
          <Text c="dimmed" size="sm">
            Joined {formatLocalDate(profile.learner.joinedAt)}
          </Text>
        </div>
        <Button component={Link} to="/admin/learners" variant="light">
          Back to learners
        </Button>
      </div>

      <section aria-labelledby="onboarding-heading">
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Title order={2} id="onboarding-heading">
              Onboarding
            </Title>
            <Button
              variant="light"
              disabled={!profile.onboarding.canRequire}
              onClick={() => {
                setConfirmReOnboarding(true);
              }}
            >
              Require re-onboarding
            </Button>
          </Group>
          {onboardingError ? <Text c="red">{onboardingError}</Text> : null}
          <Paper withBorder radius="lg" p="lg">
            {profile.onboarding.assignments.length ? (
              <Stack gap="sm">
                {profile.onboarding.assignments.map((assignment) => (
                  <Group
                    key={assignment.id}
                    justify="space-between"
                    align="flex-start"
                  >
                    <div>
                      <Text fw={600}>{assignment.surveyTitle}</Text>
                      <Text c="dimmed" size="sm">
                        Onboarding version {assignment.definitionVersion} ·
                        Survey version {assignment.surveyVersion} · Assigned{" "}
                        {formatLocalDate(assignment.assignedAt)}
                      </Text>
                    </div>
                    <Badge variant="light">
                      {assignment.status.replaceAll("_", " ")}
                    </Badge>
                  </Group>
                ))}
              </Stack>
            ) : (
              <Text>No onboarding history.</Text>
            )}
          </Paper>
        </Stack>
      </section>

      <section aria-labelledby="events-heading">
        <Stack gap="md">
          <div>
            <Title order={2} id="events-heading">
              Event participation
            </Title>
            <Text c="dimmed" size="sm" mt={4}>
              Registration decisions, historical region snapshots, attendance,
              progress, completion, and certificate eligibility.
            </Text>
          </div>
          <Suspense fallback={<LoadingSpinner label="Loading event history" />}>
            <AdminLearnerEventHistory
              events={profile.events}
              userId={profile.learner.id}
            />
          </Suspense>
        </Stack>
      </section>

      <section aria-labelledby="enrolments-heading">
        <Stack gap="md">
          <Title order={2} id="enrolments-heading">
            Course enrolments
          </Title>
          {profile.enrollments.length > 0 ? (
            <div className={classes.enrollmentGrid}>
              {profile.enrollments.map((enrollment) => {
                const progress =
                  enrollment.moduleCount === 0
                    ? 0
                    : Math.round(
                        (enrollment.completedModuleCount /
                          enrollment.moduleCount) *
                          100,
                      );
                return (
                  <Paper
                    withBorder
                    radius="lg"
                    p="lg"
                    className={classes.enrollmentCard}
                    key={enrollment.id}
                  >
                    <Stack gap="md">
                      <Group justify="space-between" align="flex-start">
                        <div>
                          <Title order={3}>{enrollment.courseTitle}</Title>
                          <Text c="dimmed" size="sm">
                            Published version {enrollment.courseVersion}
                          </Text>
                        </div>
                        <Badge variant="light">{enrollment.status}</Badge>
                      </Group>
                      <div>
                        <Group justify="space-between" mb={4}>
                          <Text size="sm" fw={600}>
                            Module progress
                          </Text>
                          <Text size="sm" c="dimmed">
                            {enrollment.completedModuleCount}/
                            {enrollment.moduleCount}
                          </Text>
                        </Group>
                        <MantineProgress
                          value={progress}
                          aria-label={`${String(progress)}% complete`}
                        />
                      </div>
                      <Text size="sm">
                        Enrolled {formatLocalDate(enrollment.enrolledAt)}
                      </Text>
                      {enrollment.lastActivityAt ? (
                        <Text size="sm" c="dimmed">
                          Last activity{" "}
                          {formatLocalDate(enrollment.lastActivityAt)}
                        </Text>
                      ) : null}
                      <Link
                        to="/admin/learners/$userId/enrollments/$enrollmentId"
                        params={{
                          userId: profile.learner.id,
                          enrollmentId: enrollment.id,
                        }}
                        className={classes.buttonLink}
                      >
                        <Button component="span" fullWidth>
                          Review progress
                        </Button>
                      </Link>
                      <Link
                        to="/courses/$slug"
                        params={{ slug: enrollment.courseSlug }}
                        className={classes.buttonLink}
                      >
                        <Button component="span" variant="subtle" fullWidth>
                          View public course
                        </Button>
                      </Link>
                    </Stack>
                  </Paper>
                );
              })}
            </div>
          ) : (
            <Paper withBorder radius="lg" p="xl">
              <Text fw={600}>This learner has no course enrolments.</Text>
            </Paper>
          )}
        </Stack>
      </section>
      {confirmReOnboarding ? (
        <ConfirmationDialog
          title="Require re-onboarding?"
          description="The learner will complete the current onboarding version at their next sign-in. Previous responses remain retained."
          confirmLabel="Require re-onboarding"
          confirmColor="blue"
          pending={processing}
          onCancel={() => {
            setConfirmReOnboarding(false);
          }}
          onConfirm={() => {
            setProcessing(true);
            setOnboardingError(null);
            void requireAdminReOnboarding({
              data: { userId: profile.learner.id },
            })
              .then(async (outcome) => {
                if (outcome.status === "ready") {
                  setConfirmReOnboarding(false);
                  await router.invalidate();
                  return;
                }
                setOnboardingError(
                  outcome.status === "conflict" &&
                    outcome.reason === "onboarding_already_required"
                    ? "Onboarding is already required for this learner."
                    : "No active onboarding version is available.",
                );
                setConfirmReOnboarding(false);
              })
              .finally(() => {
                setProcessing(false);
              });
          }}
        />
      ) : null}
    </Stack>
  );
}
