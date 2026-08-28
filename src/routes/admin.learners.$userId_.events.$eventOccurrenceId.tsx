import { useState } from "react";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import {
  AdminLearnerEventProgressPanel,
  type AdminLearnerEventProgressView,
} from "#/features/admin/AdminLearnerEventProgressPanel";
import { adminLearnerEventParamsSchema } from "#/features/admin/admin.schema";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { Button, Stack, Text, Title } from "#/features/shared/mantine";
import { PageTabs } from "#/features/shared/PageTabs";
import { getAdminLearnerEventDetail } from "#/server/functions/admin";
import classes from "./admin.module.css";

export const Route = createFileRoute(
  "/admin/learners/$userId_/events/$eventOccurrenceId",
)({
  ssr: false,
  loader: async ({ params }) => {
    const parsed = adminLearnerEventParamsSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getAdminLearnerEventDetail({ data: parsed.data });
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: {
          redirect: `/admin/learners/${encodeURIComponent(parsed.data.userId)}/events/${encodeURIComponent(parsed.data.eventOccurrenceId)}`,
        },
      });
    if (result.status === "not-found") throw notFound();
    return result;
  },
  component: AdminLearnerEventProgressPage,
});

function AdminLearnerEventProgressPage() {
  const result = Route.useLoaderData();
  const [view, setView] = useState<AdminLearnerEventProgressView>("overview");
  if (result.status === "forbidden") return <AdminAccessDenied />;
  const { event, learner } = result.data;

  return (
    <Stack gap="xl">
      <div className={classes.profileHeader}>
        <div>
          <Text c="indigo.7" fw={700}>
            Learner event progress
          </Text>
          <Title order={1}>{event.occurrence.title}</Title>
          <Text c="dimmed" mt="xs">
            {learner.name} ({learner.email})
          </Text>
          <Text c="dimmed" size="sm">
            {event.occurrence.eventTemplateTitle} · Published version{" "}
            {event.occurrence.eventTemplateVersion} ·{" "}
            {formatLocalDateTime(event.occurrence.startsAt, {
              timeZone: event.occurrence.timezone,
            })}
          </Text>
        </div>
        <Link
          to="/admin/learners/$userId"
          params={{ userId: learner.id }}
          className={classes.buttonLink}
        >
          <Button component="span" variant="light">
            Back to learner
          </Button>
        </Link>
      </div>

      <PageTabs
        label="Event progress workspace"
        value={view}
        tabs={[
          { value: "overview", label: "Overview" },
          {
            value: "attendance",
            label: `Attendance (${String(event.sessions.length)})`,
          },
          {
            value: "progress",
            label: `Progress (${String(event.progress?.sections.length ?? 0)})`,
          },
          {
            value: "history",
            label: `History (${String(event.history.length)})`,
          },
        ]}
        onChange={setView}
      />

      <AdminLearnerEventProgressPanel event={event} view={view} />
    </Stack>
  );
}
