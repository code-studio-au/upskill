import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { AdminEventOccurrenceEditor } from "#/features/admin-event/AdminEventOccurrenceEditor";
import { getAdminEventWorkspace } from "#/server/functions/admin-event";

export const Route = createFileRoute("/admin/events/instances_/new")({
  ssr: false,
  loader: async () => {
    const result = await getAdminEventWorkspace();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/events/instances/new" },
      });
    return result;
  },
  component: NewEventOccurrencePage,
});

function NewEventOccurrencePage() {
  const result = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  if (result.status === "forbidden") return <AdminAccessDenied />;
  return (
    <AdminEventOccurrenceEditor
      publishedVersions={result.data.publishedVersions}
      liveKit={result.data.liveKit}
      onCancel={() => {
        void navigate({
          to: "/admin/events/scheduled",
          search: { view: "upcoming" },
        });
      }}
      onSaved={async () => {
        await navigate({
          to: "/admin/events/scheduled",
          search: { view: "upcoming" },
        });
      }}
    />
  );
}
