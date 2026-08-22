import {
  createColumnHelper,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import {
  AdminDirectory,
  AdminDirectoryFilters,
  AdminDirectorySearch,
} from "#/features/admin/AdminDirectory";
import {
  adminLearnerSearchSchema,
  type AdminLearnerDirectory,
} from "#/features/admin/admin.schema";
import { RemovableFilterChip } from "#/features/shared/RemovableFilterChip";
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
  const table = useTable({
    features: learnerTableFeatures,
    columns: learnerColumns,
    data: directory.learners,
    manualPagination: true,
    rowCount: directory.pagination.total,
  });

  return (
    <AdminDirectory
      eyebrow="Learner support"
      title="Learners"
      countNames={{ singular: "learner", plural: "learners" }}
      pagination={directory.pagination}
      table={table}
      caption="Registered learners and enrolment totals"
      numericColumns={numericLearnerColumns}
      emptyText="No learners found."
      navigating={navigating}
      onPageChange={(page) => {
        void navigate({ search: { q: directory.query, page } });
      }}
    >
      <AdminDirectorySearch
        key={search.q}
        query={search.q}
        label="Search learners"
        placeholder="Name or email address"
        navigating={navigating}
        submitLabel="Search"
        onSubmit={(form) => {
          const validated = adminLearnerSearchSchema.parse({
            q: form.get("q"),
            page: 1,
          });
          void navigate({ search: validated });
        }}
      />
      {search.q ? (
        <AdminDirectoryFilters>
          <RemovableFilterChip
            label="Search"
            value={search.q}
            onRemove={() => {
              void navigate({ search: { q: "", page: 1 } });
            }}
          />
        </AdminDirectoryFilters>
      ) : null}
    </AdminDirectory>
  );
}
