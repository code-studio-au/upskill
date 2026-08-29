import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { AdminEnterpriseContractCreate } from "#/features/admin-contract/AdminEnterpriseContractCreate";
import { getAdminEnterpriseContracts } from "#/server/functions/admin-enterprise-contract";

export const Route = createFileRoute("/admin/contracts_/new")({
  ssr: false,
  loader: async () => {
    const result = await getAdminEnterpriseContracts();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/contracts/new" },
      });
    return result;
  },
  component: NewEnterpriseContractPage,
});

function NewEnterpriseContractPage() {
  const result = Route.useLoaderData();
  if (result.status === "forbidden") return <AdminAccessDenied />;
  return <AdminEnterpriseContractCreate directory={result.data} />;
}
