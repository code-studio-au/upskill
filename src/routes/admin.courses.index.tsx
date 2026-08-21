import { Badge } from "#/features/shared/Badge";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import {
  getAdminCourses,
  startAdminCourse,
} from "#/server/functions/admin-course";
import classes from "./admin.courses.module.css";

export const Route = createFileRoute("/admin/courses/")({
  ssr: false,
  loader: async () => {
    const result = await getAdminCourses();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/courses" },
      });
    return result;
  },
  component: AdminCoursesPage,
});

function AdminCoursesPage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function startCourse() {
    setCreating(true);
    setError(null);
    try {
      const created = await startAdminCourse();
      if (created.status !== "ready") {
        setError("The draft course could not be started.");
        return;
      }
      await router.navigate({
        to: "/admin/courses/$courseId",
        params: { courseId: created.data.courseId },
      });
    } finally {
      setCreating(false);
    }
  }

  if (result.status === "forbidden") return <AdminAccessDenied />;

  const courses = result.data;
  return (
    <Stack gap="lg">
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Text c="indigo.7" fw={700}>
            Course authoring
          </Text>
          <Title order={1}>Courses</Title>
        </div>
        <Button
          loading={creating}
          onClick={() => {
            void startCourse();
          }}
        >
          Create course
        </Button>
      </Group>

      {error ? <Alert color="red">{error}</Alert> : null}

      {courses.length === 0 ? (
        <Alert title="No courses yet">Create the first course draft.</Alert>
      ) : (
        <div className={classes.courseGrid}>
          {courses.map((course) => (
            <Paper key={course.id} withBorder radius="lg" p="md">
              <Stack gap="sm">
                <Group justify="space-between" align="start" wrap="nowrap">
                  <div className={classes.cardIdentity}>
                    <Link
                      to="/admin/courses/$courseId"
                      params={{ courseId: course.id }}
                      className={classes.cardTitleLink}
                    >
                      <Title order={2} size="h3">
                        {course.title}
                      </Title>
                    </Link>
                    <Text c="dimmed" size="sm">
                      /courses/{course.slug}
                    </Text>
                  </div>
                  <Group gap="xs" wrap="wrap" justify="flex-end">
                    {course.status === "archived" ? (
                      <Badge color="gray">
                        Archived v
                        {course.publishedVersion ?? course.latestVersion}
                      </Badge>
                    ) : (
                      <>
                        {course.publishedVersion ? (
                          <Badge color="green">
                            Published v{course.publishedVersion}
                          </Badge>
                        ) : null}
                        {course.draftVersion ? (
                          <Badge color="gray">
                            Draft v{course.draftVersion}
                          </Badge>
                        ) : null}
                      </>
                    )}
                  </Group>
                </Group>
                <Text size="sm" c="dimmed">
                  {course.enrollmentCount} enrolment
                  {course.enrollmentCount === 1 ? "" : "s"}
                </Text>
              </Stack>
            </Paper>
          ))}
        </div>
      )}
    </Stack>
  );
}
