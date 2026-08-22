import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  createFileRoute,
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
  adminNotificationSearchSchema,
  type AdminNotificationOperations,
} from "#/features/admin-notification/admin-notification.schema";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { RemovableFilterChip } from "#/features/shared/RemovableFilterChip";
import { Button } from "#/features/shared/mantine";
import {
  getAdminNotificationOperations,
  requeueAdminNotification,
} from "#/server/functions/admin-notification";
import classes from "./admin.notifications.module.css";

export const Route = createFileRoute("/admin/notifications")({
  validateSearch: adminNotificationSearchSchema,
  loaderDeps: ({ search }) => search,
  ssr: false,
  loader: async ({ deps }) => {
    const result = await getAdminNotificationOperations({ data: deps });
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/notifications" },
      });
    return result;
  },
  component: AdminNotificationsPage,
});

const notificationTableFeatures = tableFeatures({});
type NotificationRow = AdminNotificationOperations["notifications"][number];
const notificationColumn = createColumnHelper<
  typeof notificationTableFeatures,
  NotificationRow
>();

async function retry(notificationId: string) {
  if (!window.confirm("Requeue this delivery?")) return;
  const result = await requeueAdminNotification({ data: { notificationId } });
  if (result.status === "ready") window.location.reload();
  else window.alert("The delivery could not be requeued.");
}

const notificationColumns = notificationColumn.columns([
  notificationColumn.accessor("recipientName", { header: "Recipient" }),
  notificationColumn.accessor("channelLabel", { header: "Channel" }),
  notificationColumn.accessor("statusLabel", { header: "Status" }),
]);
function AdminNotificationsPage() {
  const result = Route.useLoaderData();
  if (result.status === "forbidden") return <AdminAccessDenied />;
  return <AdminNotificationDirectoryPage directory={result.data} />;
}

function AdminNotificationDirectoryPage({
  directory,
}: {
  directory: AdminNotificationOperations;
}) {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const navigating = useRouterState({
    select: (state) => state.status === "pending",
  });
  const table = useTable({
    features: notificationTableFeatures,
    columns: notificationColumns,
    data: directory.notifications,
  });

  return (
    <AdminDirectory
      title="Email and SMS delivery"
      countNames={{ singular: "delivery", plural: "deliveries" }}
      pagination={directory.pagination}
      table={table}
      caption="Deliveries"
      emptyText="No deliveries found."
      navigating={navigating}
      onPageChange={(page) => {
        void navigate({ search: { ...search, page } });
      }}
      renderExpandedRow={({ original }) => (
        <div className={classes.deliveryDetails}>
          <pre>{original.detailSummary}</pre>
          {original.canRequeue ? (
            <Button
              size="compact-xs"
              variant="light"
              onClick={() => void retry(original.id)}
            >
              Requeue
            </Button>
          ) : null}
        </div>
      )}
    >
      <section className={classes.health}>
        <h2>Delivery health</h2>
        <p>{directory.healthSummary}</p>
      </section>

      <AdminDirectorySearch
        key={`${search.q}:${search.channel}:${search.status}`}
        className={classes.deliverySearch}
        query={search.q}
        label="Search deliveries"
        placeholder="Recipient, address, subject, or batch"
        navigating={navigating}
        submitLabel="Apply filters"
        onSubmit={(form) => {
          const validated = adminNotificationSearchSchema.parse({
            q: form.get("q"),
            status: form.get("status"),
            channel: form.get("channel"),
            page: 1,
          });
          void navigate({ search: validated });
        }}
        secondary={
          <div className={classes.secondaryFilters}>
            <MantineNativeSelect
              name="channel"
              label="Channel"
              defaultValue={search.channel}
              data={directory.channelOptions}
            />
            <MantineNativeSelect
              name="status"
              label="Status"
              defaultValue={search.status}
              data={directory.statusOptions}
            />
          </div>
        }
      />
      {search.q || search.channel !== "all" || search.status !== "all" ? (
        <AdminDirectoryFilters>
          {search.q ? (
            <RemovableFilterChip
              label="Search"
              value={search.q}
              onRemove={() => {
                void navigate({ search: { ...search, q: "", page: 1 } });
              }}
            />
          ) : null}
          {(["status", "channel"] as const).map((field) =>
            search[field] === "all" ? null : (
              <RemovableFilterChip
                key={field}
                label={field === "status" ? "Status" : "Channel"}
                value={search[field]}
                onRemove={() => {
                  void navigate({
                    search: { ...search, [field]: "all", page: 1 },
                  });
                }}
              />
            ),
          )}
        </AdminDirectoryFilters>
      ) : null}
    </AdminDirectory>
  );
}
