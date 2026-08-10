import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdminAccessGrantManager } from "#/features/admin-access/AdminAccessGrantManager";
import { getAdminAccessGrants } from "#/server/functions/admin-access-grant";

export const Route = createFileRoute("/admin/access")({
  loader: async () => {
    const result = await getAdminAccessGrants();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/access" },
      });
    return result;
  },
  component: AdminAccessPage,
});

function AdminAccessPage() {
  return <AdminAccessGrantManager result={Route.useLoaderData()} />;
}
