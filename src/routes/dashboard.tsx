import { Badge } from "#/features/shared/Badge";
import {
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { AccessCodeRedemptionForm } from "#/features/access/AccessCodeRedemptionForm";
import { LearnerCertificateAction } from "#/features/learner/LearnerCertificateAction";
import { formatLocalDate } from "#/features/shared/local-date";
import { AppDialog } from "#/features/shared/AppDialog";
import type { LearnerCourse } from "#/features/learner/learner.schema";
import { getLearnerDashboard } from "#/server/functions/learner";
import { getLearnerOnboarding } from "#/server/functions/onboarding";
import classes from "./dashboard.module.css";

export const Route = createFileRoute("/dashboard")({
  ssr: "data-only",
  loader: async () => {
    const onboarding = await getLearnerOnboarding();
    if (onboarding.status === "ready")
      throw redirect({
        to: "/onboarding",
        search: { editContact: undefined, verification: undefined },
      });
    const dashboard = await getLearnerDashboard();
    if (!dashboard)
      throw redirect({
        to: "/login",
        search: { redirect: "/dashboard" },
      });
    return dashboard;
  },
  component: DashboardPage,
});

function statusLabel(course: LearnerCourse): string {
  if (course.state === "completed") return "Completed";
  if (course.state === "expired") return "Expired";
  if (course.state === "cancelled") return "Removed";
  return "In progress";
}

function DashboardPage() {
  const dashboard = Route.useLoaderData();
  const [accessCodeOpen, setAccessCodeOpen] = useState(false);
  const current = dashboard.courses.filter(
    (course) => course.state === "active" || course.state === "completed",
  );
  const history = dashboard.courses.filter(
    (course) => course.state === "expired" || course.state === "cancelled",
  );

  return (
    <Container size="lg" className={classes.section}>
      <Stack gap="xl">
        <div className={classes.heading}>
          <div>
            <Text c="indigo.7" fw={700}>
              Learner area
            </Text>
            <Title order={1}>My learning</Title>
          </div>
          <Button
            variant="light"
            onClick={() => {
              setAccessCodeOpen(true);
            }}
          >
            Redeem access code
          </Button>
        </div>

        {accessCodeOpen ? (
          <AppDialog
            title="Redeem an access code"
            onClose={() => {
              setAccessCodeOpen(false);
            }}
          >
            <AccessCodeRedemptionForm />
          </AppDialog>
        ) : null}

        <CourseSection title="Continue learning" courses={current} />

        {dashboard.availableCourses.length > 0 ? (
          <section aria-labelledby="available-heading">
            <Stack gap="md">
              <div>
                <Title order={2} id="available-heading">
                  Available through your organisation
                </Title>
                <Text c="dimmed">
                  Eligible for {dashboard.availableCourses[0]?.domain}
                </Text>
              </div>
              <div className={classes.grid}>
                {dashboard.availableCourses.map((course) => (
                  <Paper
                    withBorder
                    radius="lg"
                    p="md"
                    className={classes.courseCard}
                    key={course.slug}
                  >
                    <Stack gap="md" h="100%">
                      <Group justify="space-between">
                        <Badge variant="light" color="teal">
                          Organisation access
                        </Badge>
                        <Text size="sm" c="dimmed">
                          {course.durationMinutes} min
                        </Text>
                      </Group>
                      <Title order={3}>{course.title}</Title>
                      <Text c="dimmed" className={classes.courseSummary}>
                        {course.summary}
                      </Text>
                      <Link
                        to="/courses/$slug"
                        params={{ slug: course.slug }}
                        className={classes.courseLink}
                      >
                        <Button component="span" variant="light" fullWidth>
                          View course
                        </Button>
                      </Link>
                    </Stack>
                  </Paper>
                ))}
              </div>
            </Stack>
          </section>
        ) : null}

        {history.length > 0 ? (
          <CourseSection title="Learning history" courses={history} />
        ) : null}
      </Stack>
    </Container>
  );
}

function CourseSection({
  title,
  courses,
}: {
  title: string;
  courses: Array<LearnerCourse>;
}) {
  const headingId = title.toLocaleLowerCase("en-AU").replaceAll(" ", "-");
  return (
    <section aria-labelledby={headingId}>
      <Stack gap="md">
        <Title order={2} id={headingId}>
          {title}
        </Title>
        {courses.length > 0 ? (
          <div className={classes.grid}>
            {courses.map((course) => (
              <Paper
                withBorder
                radius="lg"
                p="md"
                className={classes.courseCard}
                key={course.enrollmentId}
              >
                <Stack gap="md" h="100%">
                  <Group justify="space-between">
                    <Badge variant="light">{statusLabel(course)}</Badge>
                    <Text size="sm" c="dimmed">
                      {course.durationMinutes} min
                    </Text>
                  </Group>
                  <Title order={3}>{course.title}</Title>
                  <Text c="dimmed" className={classes.courseSummary}>
                    {course.summary}
                  </Text>
                  <Text size="sm">
                    Enrolled {formatLocalDate(course.enrolledAt)}
                  </Text>
                  {course.expiresAt ? (
                    <Text size="sm" c="dimmed">
                      Access until {formatLocalDate(course.expiresAt)}
                    </Text>
                  ) : null}
                  {course.state === "active" || course.state === "completed" ? (
                    <Stack gap="xs">
                      <Link
                        to="/learn/$enrollmentId"
                        params={{ enrollmentId: course.enrollmentId }}
                        className={classes.courseLink}
                      >
                        <Button component="span" fullWidth>
                          {course.state === "completed"
                            ? "Review course"
                            : "Continue course"}
                        </Button>
                      </Link>
                      {course.certificate ? (
                        <LearnerCertificateAction
                          certificate={course.certificate}
                        />
                      ) : null}
                    </Stack>
                  ) : (
                    <Link
                      to="/courses/$slug"
                      params={{ slug: course.slug }}
                      className={classes.courseLink}
                    >
                      <Button component="span" variant="light" fullWidth>
                        {course.state === "expired"
                          ? "Renew access"
                          : "View course"}
                      </Button>
                    </Link>
                  )}
                </Stack>
              </Paper>
            ))}
          </div>
        ) : (
          <div className={classes.empty}>
            <Text fw={600}>No courses in progress.</Text>
            <Button component={Link} to="/courses" variant="light" mt="md">
              Browse courses
            </Button>
          </div>
        )}
      </Stack>
    </section>
  );
}
