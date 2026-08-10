import { Badge } from "#/features/shared/Badge";
import { Alert, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { useForm } from "@tanstack/react-form";
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
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { firstFormError } from "#/features/shared/form-errors";
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
  const [error, setError] = useState<string | null>(null);
  const courseForm = useForm({
    defaultValues: { title: "", slug: "" },
    validators: { onSubmit: adminCourseCreateSchema },
    onSubmit: async ({ value }) => {
      const parsed = adminCourseCreateSchema.safeParse(value);
      if (!parsed.success) return;
      setError(null);
      const created = await createAdminCourse({ data: parsed.data });
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
    },
  });

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
            courseForm.reset();
            setError(null);
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
            <Paper key={course.id} withBorder radius="lg" p="lg">
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
            </Paper>
          ))}
        </div>
      )}

      {opened ? (
        <courseForm.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <AppDialog
              onClose={() => {
                if (!isSubmitting) setOpened(false);
              }}
              closeDisabled={isSubmitting}
              title="Create course"
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void courseForm.handleSubmit();
                }}
              >
                <Stack gap="md">
                  <courseForm.Field name="title">
                    {(field) => (
                      <MantineTextInput
                        label="Course title"
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          field.handleChange(value);
                          courseForm.setFieldValue(
                            "slug",
                            value
                              .toLocaleLowerCase("en-AU")
                              .replace(/[^a-z0-9]+/g, "-")
                              .replace(/^-|-$/g, ""),
                          );
                        }}
                        error={firstFormError(field.state.meta.errors)}
                        required
                      />
                    )}
                  </courseForm.Field>
                  <courseForm.Field name="slug">
                    {(field) => (
                      <MantineTextInput
                        label="URL slug"
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.currentTarget.value);
                        }}
                        error={firstFormError(field.state.meta.errors)}
                        required
                      />
                    )}
                  </courseForm.Field>
                  {error ? <Alert color="red">{error}</Alert> : null}
                  <Group justify="flex-end">
                    <Button
                      type="button"
                      variant="default"
                      onClick={() => {
                        setOpened(false);
                      }}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                    <courseForm.Subscribe selector={(state) => state.canSubmit}>
                      {(canSubmit) => (
                        <Button
                          type="submit"
                          loading={isSubmitting}
                          disabled={!canSubmit}
                        >
                          Create draft
                        </Button>
                      )}
                    </courseForm.Subscribe>
                  </Group>
                </Stack>
              </form>
            </AppDialog>
          )}
        </courseForm.Subscribe>
      ) : null}
    </Stack>
  );
}
