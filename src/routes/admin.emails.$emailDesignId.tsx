import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { AdminEmailDesignEditor } from "#/features/admin-email/AdminEmailDesignEditor";
import {
  adminEmailDesignParamsSchema,
  adminEmailDesignSearchSchema,
} from "#/features/admin-email/admin-email.schema";
import { getAdminEmailDesign } from "#/server/functions/admin-email";

export const Route = createFileRoute("/admin/emails/$emailDesignId")({
  validateSearch: adminEmailDesignSearchSchema,
  loaderDeps: ({ search }) => search,
  ssr: false,
  loader: async ({ params, deps }) => {
    const parsed = adminEmailDesignParamsSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getAdminEmailDesign({
      data: { ...parsed.data, versionId: deps.versionId },
    });
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: {
          redirect: `/admin/emails/${encodeURIComponent(parsed.data.emailDesignId)}`,
        },
      });
    if (result.status === "not-found") throw notFound();
    return result;
  },
  component: AdminEmailDesignPage,
});

function AdminEmailDesignPage() {
  const result = Route.useLoaderData();
  if (result.status === "forbidden") return <AdminAccessDenied />;
  return (
    <AdminEmailDesignEditor
      key={`${result.data.version.id}-${result.data.version.publishedAt ?? "draft"}`}
      detail={result.data}
    />
  );
}
