import { Badge, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { MantineProgress } from "#/features/shared/MantineProgress";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { adminLearnerParamsSchema } from "#/features/admin/admin.schema";
import { getAdminLearnerProfile } from "#/server/functions/admin";
import classes from "./admin.module.css";

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

const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function AdminLearnerProfilePage() {
  const result = Route.useLoaderData();
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
            Joined {dateFormatter.format(new Date(profile.learner.joinedAt))}
          </Text>
        </div>
        <Button component={Link} to="/admin/learners" variant="light">
          Back to learners
        </Button>
      </div>

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
                        Enrolled{" "}
                        {dateFormatter.format(new Date(enrollment.enrolledAt))}
                      </Text>
                      {enrollment.lastActivityAt ? (
                        <Text size="sm" c="dimmed">
                          Last activity{" "}
                          {dateFormatter.format(
                            new Date(enrollment.lastActivityAt),
                          )}
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
    </Stack>
  );
}
