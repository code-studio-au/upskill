import {
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { adminLearnerSearchSchema } from "#/features/admin/admin.schema";
import { getAdminLearners } from "#/server/functions/admin";
import classes from "./admin.module.css";

export const Route = createFileRoute("/admin/learners/")({
  validateSearch: adminLearnerSearchSchema,
  loaderDeps: ({ search }) => search,
  ssr: false,
  loader: async ({ deps }) => {
    const result = await getAdminLearners({ data: deps });
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/learners" },
      });
    return result;
  },
  component: AdminLearnersPage,
});

function AdminLearnersPage() {
  const result = Route.useLoaderData();
  if (result.status === "forbidden") return <AdminAccessDenied />;
  const directory = result.data;

  return (
    <Stack gap="xl">
      <div className={classes.heading}>
        <Text c="indigo.7" fw={700}>
          Learner support
        </Text>
        <Title order={1}>Learners</Title>
        <Text c="dimmed" mt="xs">
          Search registered learners and inspect their enrolment history.
        </Text>
      </div>

      <form
        method="get"
        action="/admin/learners"
        className={classes.searchForm}
      >
        <TextInput
          name="q"
          label="Search learners"
          defaultValue={directory.query}
          placeholder="Name or email address"
          maxLength={100}
        />
        <Button type="submit">Search</Button>
      </form>

      <Text c="dimmed" size="sm">
        {directory.pagination.total} learner
        {directory.pagination.total === 1 ? "" : "s"} found
      </Text>

      {directory.learners.length > 0 ? (
        <div className={classes.learnerGrid}>
          {directory.learners.map((learner) => (
            <Paper
              withBorder
              radius="lg"
              p="lg"
              className={classes.learnerCard}
              key={learner.id}
            >
              <Stack gap="md" h="100%">
                <div className={classes.learnerHeader}>
                  <div>
                    <Title order={2} size="h3">
                      {learner.name}
                    </Title>
                    <Text c="dimmed" size="sm">
                      {learner.email}
                    </Text>
                  </div>
                  <Badge variant="light">Learner</Badge>
                </div>
                <div className={classes.metrics}>
                  <Metric label="Enrolments" value={learner.enrollments} />
                  <Metric label="Active" value={learner.activeEnrollments} />
                  <Metric
                    label="Completed"
                    value={learner.completedEnrollments}
                  />
                </div>
                <Link
                  to="/admin/learners/$userId"
                  params={{ userId: learner.id }}
                  className={classes.profileLink}
                >
                  <Button component="span" variant="light" fullWidth>
                    View learner profile
                  </Button>
                </Link>
              </Stack>
            </Paper>
          ))}
        </div>
      ) : (
        <Paper withBorder radius="lg" p="xl">
          <Title order={2} size="h3">
            No learners found
          </Title>
          <Text c="dimmed" mt="xs">
            Try another name or email address.
          </Text>
        </Paper>
      )}

      {directory.pagination.pages > 1 ? (
        <Group justify="space-between">
          {directory.pagination.page === 1 ? (
            <Button variant="light" disabled>
              Previous
            </Button>
          ) : (
            <Link
              to="/admin/learners"
              search={{
                q: directory.query,
                page: directory.pagination.page - 1,
              }}
              className={classes.buttonLink}
            >
              <Button component="span" variant="light">
                Previous
              </Button>
            </Link>
          )}
          <Text size="sm">
            Page {directory.pagination.page} of {directory.pagination.pages}
          </Text>
          {directory.pagination.page === directory.pagination.pages ? (
            <Button variant="light" disabled>
              Next
            </Button>
          ) : (
            <Link
              to="/admin/learners"
              search={{
                q: directory.query,
                page: directory.pagination.page + 1,
              }}
              className={classes.buttonLink}
            >
              <Button component="span" variant="light">
                Next
              </Button>
            </Link>
          )}
        </Group>
      ) : null}
    </Stack>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={classes.metric}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={800}>{value}</Text>
    </div>
  );
}
