import {
  createFileRoute,
  notFound,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { AdminEventTemplateEditor } from "#/features/admin-event/AdminEventTemplateEditor";
import { adminEventTemplateParamsSchema } from "#/features/admin-event/admin-event.schema";
import { getAdminEventTemplate } from "#/server/functions/admin-event";

export const Route = createFileRoute("/admin/events/$eventTemplateId")({
  ssr: false,
  loader: async ({ params }) => {
    const parsed = adminEventTemplateParamsSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getAdminEventTemplate({ data: parsed.data });
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: {
          redirect: `/admin/events/${encodeURIComponent(parsed.data.eventTemplateId)}`,
        },
      });
    if (result.status === "not-found") throw notFound();
    return result;
  },
  component: AdminEventTemplatePage,
});

function AdminEventTemplatePage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  if (result.status === "forbidden") return <AdminAccessDenied />;
  return (
    <AdminEventTemplateEditor
      key={`${result.data.version.id}-${result.data.version.publishedAt ?? "draft"}`}
      detail={result.data}
      onChanged={async () => {
        await router.invalidate();
      }}
    />
  );
}
