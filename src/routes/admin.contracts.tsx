import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdminEnterpriseContractManager } from "#/features/admin-contract/AdminEnterpriseContractManager";
import { getAdminEnterpriseContracts } from "#/server/functions/admin-enterprise-contract";

export const Route = createFileRoute("/admin/contracts")({
  loader: async () => {
    const result = await getAdminEnterpriseContracts();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/contracts" },
      });
    return result;
  },
  component: AdminEnterpriseContractsPage,
});

function AdminEnterpriseContractsPage() {
  return <AdminEnterpriseContractManager result={Route.useLoaderData()} />;
}
