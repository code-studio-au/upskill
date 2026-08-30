import {
  createFileRoute,
  notFound,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { AdminSurveyEditor } from "#/features/survey/AdminSurveyEditor";
import {
  adminSurveyParamsSchema,
  adminSurveySearchSchema,
} from "#/features/survey/survey.schema";
import { getAdminSurvey } from "#/server/functions/admin-survey";

export const Route = createFileRoute("/admin/surveys/$surveyId")({
  validateSearch: adminSurveySearchSchema,
  loaderDeps: ({ search }) => ({ version: search.version }),
  ssr: false,
  loader: async ({ params, deps }) => {
    const parsed = adminSurveyParamsSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getAdminSurvey({
      data: {
        ...parsed.data,
        ...(deps.version ? { versionId: deps.version } : {}),
      },
    });
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: {
          redirect: `/admin/surveys/${encodeURIComponent(parsed.data.surveyId)}`,
        },
      });
    if (result.status === "not-found") throw notFound();
    return result;
  },
  component: AdminSurveyPage,
});

function AdminSurveyPage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  if (result.status === "forbidden") return <AdminAccessDenied />;
  return (
    <AdminSurveyEditor
      key={`${result.data.version.id}-${result.data.version.publishedAt ?? "draft"}`}
      detail={result.data}
      onChanged={async () => router.invalidate()}
    />
  );
}
