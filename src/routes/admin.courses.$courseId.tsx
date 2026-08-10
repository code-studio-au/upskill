import {
  createFileRoute,
  notFound,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { AdminCourseEditor } from "#/features/admin-course/AdminCourseEditor";
import { adminCourseParamsSchema } from "#/features/admin-course/admin-course.schema";
import { getAdminCourse } from "#/server/functions/admin-course";

export const Route = createFileRoute("/admin/courses/$courseId")({
  ssr: false,
  loader: async ({ params }) => {
    const parsed = adminCourseParamsSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getAdminCourse({ data: parsed.data });
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: {
          redirect: `/admin/courses/${encodeURIComponent(parsed.data.courseId)}`,
        },
      });
    if (result.status === "not-found") throw notFound();
    return result;
  },
  component: AdminCoursePage,
});

function AdminCoursePage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  if (result.status === "forbidden") return <AdminAccessDenied />;
  return (
    <AdminCourseEditor
      key={`${result.data.version.id}-${result.data.version.publishedAt ?? "draft"}`}
      detail={result.data}
      onChanged={async () => {
        await router.invalidate();
      }}
    />
  );
}
