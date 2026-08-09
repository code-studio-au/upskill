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
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import {
  adminLearnerSearchSchema,
  type AdminLearnerSearch,
} from "#/features/admin/admin.schema";
import { RemovableFilterChip } from "#/features/shared/RemovableFilterChip";
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
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const navigating = useRouterState({
    select: (state) => state.status === "pending",
  });
  const [submittedSearch, setSubmittedSearch] = useState<AdminLearnerSearch>();
  useEffect(() => {
    if (submittedSearch) void navigate({ search: submittedSearch });
  }, [navigate, submittedSearch]);
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
        key={search.q}
        className={classes.searchForm}
        action={(form) => {
          const validated = adminLearnerSearchSchema.parse({
            q: form.get("q"),
            page: 1,
          });
          setSubmittedSearch(validated);
        }}
      >
        <TextInput
          name="q"
          label="Search learners"
          defaultValue={search.q}
          placeholder="Name or email address"
          maxLength={100}
        />
        <Button type="submit" loading={navigating}>
          Search
        </Button>
      </form>

      {search.q ? (
        <Stack gap="xs">
          <Text size="sm" fw={700}>
            Current filters
          </Text>
          <Group gap="xs">
            <RemovableFilterChip
              label="Search"
              value={search.q}
              onRemove={() => {
                void navigate({ search: { q: "", page: 1 } });
              }}
            />
          </Group>
        </Stack>
      ) : null}

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
