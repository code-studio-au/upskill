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
  useRouter,
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
import { AccountInviteDialog } from "#/features/shared/AccountInviteDialog";
import { Badge } from "#/features/shared/Badge";
import { Alert, Button, Group } from "#/features/shared/mantine";
import { getAdminLearners, inviteAdminLearner } from "#/server/functions/admin";
import { useState } from "react";
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
  learnerColumn.accessor("accountState", {
    header: "Account",
    cell: ({ row }) => (
      <Badge variant="light">
        {row.original.accountState === "active" ? "Active" : "Setup pending"}
      </Badge>
    ),
  }),
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
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
      <Group justify="space-between" align="center">
        {message ? (
          <Alert color="green" role="status">
            {message}
          </Alert>
        ) : (
          <span />
        )}
        <Button
          onClick={() => {
            setInviting(true);
          }}
        >
          Add learner
        </Button>
      </Group>
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
      {inviting ? (
        <AccountInviteDialog
          title="Add learner"
          description="A new learner receives a secure account-setup email. If the account already exists, Upskill reuses it without creating a duplicate."
          submitLabel="Add learner"
          onClose={() => {
            setInviting(false);
          }}
          onInvite={async (input) => {
            const result = await inviteAdminLearner({ data: input });
            if (result.status !== "ready")
              return "The learner account could not be added.";
            setMessage(
              result.data.outcome === "invited"
                ? "Learner created and account setup queued."
                : result.data.outcome === "resent"
                  ? "The existing setup invitation was refreshed."
                  : "That learner account already exists.",
            );
            setInviting(false);
            await router.invalidate();
            return null;
          }}
        />
      ) : null}
    </AdminDirectory>
  );
}
