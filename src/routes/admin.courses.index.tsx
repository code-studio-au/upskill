import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { adminCourseCreateSchema } from "#/features/admin-course/admin-course.schema";
import { AppDialog } from "#/features/shared/AppDialog";
import {
  createAdminCourse,
  getAdminCourses,
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
  const [opened, setOpened] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (result.status === "forbidden") return <AdminAccessDenied />;

  const courses = result.data;
  return (
    <Stack gap="xl">
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Text c="indigo.7" fw={700}>
            Course authoring
          </Text>
          <Title order={1}>Courses</Title>
          <Text c="dimmed" mt="xs">
            Build immutable course versions from ordered sections, modules and
            resources.
          </Text>
        </div>
        <Button
          onClick={() => {
            setOpened(true);
          }}
        >
          Create course
        </Button>
      </Group>

      {courses.length === 0 ? (
        <Alert title="No courses yet">Create the first course draft.</Alert>
      ) : (
        <div className={classes.courseGrid}>
          {courses.map((course) => (
            <Card key={course.id} withBorder radius="lg" padding="lg">
              <Stack gap="md">
                <Group justify="space-between" align="start">
                  <div>
                    <Title order={2} size="h3">
                      {course.title}
                    </Title>
                    <Text c="dimmed" size="sm">
                      /courses/{course.slug}
                    </Text>
                  </div>
                  <Badge
                    color={course.status === "archived" ? "gray" : "indigo"}
                    variant="light"
                  >
                    {course.status}
                  </Badge>
                </Group>
                <Text size="sm">
                  Version {course.latestVersion}
                  {course.draftVersion
                    ? ` · Draft v${String(course.draftVersion)}`
                    : " · Published"}
                </Text>
                <Text size="sm" c="dimmed">
                  {course.enrollmentCount} enrolments ·{" "}
                  {course.commerceReferenceCount} commerce references
                </Text>
                <Link
                  to="/admin/courses/$courseId"
                  params={{ courseId: course.id }}
                >
                  <Button component="span" variant="light" fullWidth>
                    Open course
                  </Button>
                </Link>
              </Stack>
            </Card>
          ))}
        </div>
      )}

      {opened ? (
        <AppDialog
          onClose={() => {
            if (!creating) setOpened(false);
          }}
          closeDisabled={creating}
          title="Create course"
        >
          <Stack gap="md">
            <TextInput
              label="Course title"
              value={title}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setTitle(value);
                setSlug(
                  value
                    .toLocaleLowerCase("en-AU")
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, ""),
                );
              }}
              required
            />
            <TextInput
              label="URL slug"
              value={slug}
              onChange={(event) => {
                setSlug(event.currentTarget.value);
              }}
              required
            />
            {error ? <Alert color="red">{error}</Alert> : null}
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  setOpened(false);
                }}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                loading={creating}
                onClick={() => {
                  const parsed = adminCourseCreateSchema.safeParse({
                    title,
                    slug,
                  });
                  if (!parsed.success) {
                    setError(
                      "Enter a title and a lowercase hyphenated URL slug.",
                    );
                    return;
                  }
                  setCreating(true);
                  setError(null);
                  void createAdminCourse({ data: parsed.data })
                    .then(async (created) => {
                      if (created.status !== "ready") {
                        setError(
                          created.status === "conflict"
                            ? "That URL slug is already in use."
                            : "The course could not be created.",
                        );
                        return;
                      }
                      await router.navigate({
                        to: "/admin/courses/$courseId",
                        params: { courseId: created.data.courseId },
                      });
                    })
                    .finally(() => {
                      setCreating(false);
                    });
                }}
              >
                Create draft
              </Button>
            </Group>
          </Stack>
        </AppDialog>
      ) : null}
    </Stack>
  );
}
