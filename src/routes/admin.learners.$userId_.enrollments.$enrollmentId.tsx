import { Button, Stack, Text, Title } from "#/features/shared/mantine";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { adminEnrollmentParamsSchema } from "#/features/admin/admin.schema";
import {
  AdminEnrollmentProgressPanel,
  type AdminEnrollmentProgressView,
} from "#/features/admin-enrollment/AdminEnrollmentProgressPanel";
import { PageTabs } from "#/features/shared/PageTabs";
import { getAdminEnrollmentDetail } from "#/server/functions/admin";
import classes from "./admin.module.css";

export const Route = createFileRoute(
  "/admin/learners/$userId_/enrollments/$enrollmentId",
)({
  ssr: false,
  loader: async ({ params }) => {
    const parsed = adminEnrollmentParamsSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getAdminEnrollmentDetail({ data: parsed.data });
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: {
          redirect: `/admin/learners/${encodeURIComponent(parsed.data.userId)}/enrollments/${encodeURIComponent(parsed.data.enrollmentId)}`,
        },
      });
    if (result.status === "not-found") throw notFound();
    return result;
  },
  component: AdminEnrollmentPage,
});

function AdminEnrollmentPage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const [view, setView] = useState<AdminEnrollmentProgressView>("overview");
  if (result.status === "forbidden") return <AdminAccessDenied />;
  const detail = result.data;
  const refresh = async () => {
    await router.invalidate({ sync: true });
  };

  return (
    <Stack gap="xl">
      <div className={classes.profileHeader}>
        <div>
          <Text c="indigo.7" fw={700}>
            Learner course progress
          </Text>
          <Title order={1}>{detail.enrollment.courseTitle}</Title>
          <Text c="dimmed" mt="xs">
            {detail.learner.name} ({detail.learner.email})
          </Text>
          <Text c="dimmed" size="sm">
            Published version {detail.enrollment.courseVersion}
          </Text>
        </div>
        <Link
          to="/admin/learners/$userId"
          params={{ userId: detail.learner.id }}
          className={classes.buttonLink}
        >
          <Button component="span" variant="light">
            Back to learner
          </Button>
        </Link>
      </div>

      <PageTabs
        label="Enrollment progress workspace"
        value={view}
        tabs={[
          { value: "overview", label: "Overview" },
          {
            value: "modules",
            label: `Modules (${String(detail.modules.length)})`,
          },
          {
            value: "corrections",
            label: `Corrections (${String(detail.overrideHistory.length)})`,
          },
        ]}
        onChange={setView}
      />

      <AdminEnrollmentProgressPanel
        detail={detail}
        refresh={refresh}
        view={view}
      />
    </Stack>
  );
}
