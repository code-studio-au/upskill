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
import { z } from "#/validation/zod";

const searchSchema = z.object({
  version: z.optional(
    z.string().check(z.trim(), z.minLength(1), z.maxLength(255)),
  ),
});

export const Route = createFileRoute("/admin/courses/$courseId")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ version: search.version }),
  ssr: false,
  loader: async ({ params, deps }) => {
    const parsed = adminCourseParamsSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getAdminCourse({
      data: {
        ...parsed.data,
        ...(deps.version ? { courseVersionId: deps.version } : {}),
      },
    });
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
