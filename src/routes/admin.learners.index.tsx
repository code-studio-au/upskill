import {
  createColumnHelper,
  rowPaginationFeature,
  tableFeatures,
  useTable,
  type PaginationState,
} from "@tanstack/react-table";
import { Button, Group, Text, Title } from "#/features/shared/mantine";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import {
  adminLearnerSearchSchema,
  type AdminLearnerDirectory,
  type AdminLearnerSearch,
} from "#/features/admin/admin.schema";
import { RemovableFilterChip } from "#/features/shared/RemovableFilterChip";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { ResponsiveDataTable } from "#/features/shared/ResponsiveDataTable";
import { getAdminLearners } from "#/server/functions/admin";
import classes from "./admin.learners.index.module.css";

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

const learnerTableFeatures = tableFeatures({ rowPaginationFeature });
type LearnerRow = AdminLearnerDirectory["learners"][number];
const learnerColumn = createColumnHelper<
  typeof learnerTableFeatures,
  LearnerRow
>();
const learnerColumns = learnerColumn.columns([
  learnerColumn.accessor("name", {
    header: "Learner",
    cell: ({ row }) => (
      <Link
        to="/admin/learners/$userId"
        params={{ userId: row.original.id }}
        className={classes.learnerNameLink}
      >
        {row.original.name}
      </Link>
    ),
  }),
  learnerColumn.accessor("email", { header: "Email" }),
  learnerColumn.accessor("enrollments", { header: "Enrolments" }),
  learnerColumn.accessor("activeEnrollments", { header: "Active" }),
  learnerColumn.accessor("completedEnrollments", { header: "Completed" }),
]);
const numericLearnerColumns = new Set([
  "enrollments",
  "activeEnrollments",
  "completedEnrollments",
]);

function AdminLearnersPage() {
  const result = Route.useLoaderData();
  if (result.status === "forbidden") return <AdminAccessDenied />;
  return <AdminLearnerDirectoryPage directory={result.data} />;
}

function AdminLearnerDirectoryPage({
  directory,
}: {
  directory: AdminLearnerDirectory;
}) {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const navigating = useRouterState({
    select: (state) => state.status === "pending",
  });
  const [submittedSearch, setSubmittedSearch] = useState<AdminLearnerSearch>();
  useEffect(() => {
    if (submittedSearch) void navigate({ search: submittedSearch });
  }, [navigate, submittedSearch]);
  const pagination = useMemo<PaginationState>(
    () => ({
      pageIndex: directory.pagination.page - 1,
      pageSize: directory.pagination.pageSize,
    }),
    [directory.pagination.page, directory.pagination.pageSize],
  );
  const table = useTable({
    features: learnerTableFeatures,
    columns: learnerColumns,
    data: directory.learners,
    manualPagination: true,
    rowCount: directory.pagination.total,
    state: { pagination },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(pagination) : updater;
      if (next.pageIndex === pagination.pageIndex) return;
      void navigate({
        search: { q: directory.query, page: next.pageIndex + 1 },
      });
    },
  });
  const firstResult =
    directory.pagination.total === 0
      ? 0
      : directory.pagination.pageSize * (directory.pagination.page - 1) + 1;
  const lastResult = directory.learners.length
    ? firstResult + directory.learners.length - 1
    : 0;

  return (
    <section
      className={classes.root}
      aria-labelledby="learner-directory-heading"
    >
      <header className={classes.header}>
        <div>
          <Text c="indigo.7" fw={700}>
            Learner support
          </Text>
          <Title order={1} id="learner-directory-heading">
            Learners
          </Title>
        </div>
        <span className={classes.count}>
          {directory.pagination.total} learner
          {directory.pagination.total === 1 ? "" : "s"}
        </span>
      </header>

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
        <MantineTextInput
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
        <div className={classes.filters}>
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
        </div>
      ) : null}

      <Text c="dimmed" size="sm">
        Showing {firstResult}–{lastResult} of {directory.pagination.total}{" "}
        learner{directory.pagination.total === 1 ? "" : "s"}
      </Text>

      {directory.learners.length > 0 ? (
        <ResponsiveDataTable
          table={table}
          caption="Registered learners and enrolment totals"
          numericColumns={numericLearnerColumns}
        />
      ) : (
        <p className={classes.empty}>No learners found.</p>
      )}

      {directory.pagination.pages > 1 ? (
        <Group justify="space-between" className={classes.pagination}>
          <Button
            variant="light"
            disabled={!table.getCanPreviousPage() || navigating}
            onClick={() => {
              table.previousPage();
            }}
          >
            Previous
          </Button>
          <Text size="sm">
            Page {directory.pagination.page} of {directory.pagination.pages}
          </Text>
          <Button
            variant="light"
            disabled={!table.getCanNextPage() || navigating}
            onClick={() => {
              table.nextPage();
            }}
          >
            Next
          </Button>
        </Group>
      ) : null}
    </section>
  );
}
