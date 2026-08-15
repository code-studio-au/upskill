import { lazy, Suspense } from "react";
import {
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
import { PageTabs } from "#/features/shared/PageTabs";
import { Stack, Text, Title } from "#/features/shared/mantine";
import { getAdminEventWorkspace } from "#/server/functions/admin-event";
import { z } from "#/validation/zod";

const searchSchema = z.object({
  view: z.catch(z.enum(["staff", "regions"]), "staff"),
});

const AdminEventStaffRoster = lazy(async () => {
  const module = await import("#/features/admin-event/AdminEventStaffRoster");
  return { default: module.AdminEventStaffRoster };
});

const AdminCoordinationRegionDirectory = lazy(async () => {
  const module =
    await import("#/features/admin-event/AdminCoordinationRegionDirectory");
  return { default: module.AdminCoordinationRegionDirectory };
});

export const Route = createFileRoute("/admin/events/settings")({
  validateSearch: searchSchema,
  ssr: false,
  loader: async () => {
    const result = await getAdminEventWorkspace();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/events/settings" },
      });
    return result;
  },
  component: EventSettingsPage,
});

function EventSettingsPage() {
  const result = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  if (result.status === "forbidden") return <AdminAccessDenied />;

  return (
    <Stack gap="lg">
      <div>
        <Text c="indigo.7" fw={700}>
          Events
        </Text>
        <Title order={1}>Event settings</Title>
        <Text c="dimmed" mt="xs" maw={760}>
          Manage the eligible staff roster and reusable coordination regions
          available to new templates and scheduled events.
        </Text>
      </div>

      <PageTabs
        label="Event settings"
        value={search.view}
        tabs={[
          {
            value: "staff",
            label: `Event staff (${String(result.data.presenters.length + result.data.coordinators.length)})`,
          },
          {
            value: "regions",
            label: `Regions (${String(result.data.regions.length)})`,
          },
        ]}
        onChange={(view) => void navigate({ search: { view } })}
      />

      {search.view === "staff" ? (
        <Suspense fallback={<LoadingSpinner label="Loading event staff" />}>
          <AdminEventStaffRoster
            presenters={result.data.presenters}
            coordinators={result.data.coordinators}
            regions={result.data.regions}
            onChanged={async () => {
              await router.invalidate();
            }}
          />
        </Suspense>
      ) : (
        <Suspense fallback={<LoadingSpinner label="Loading regions" />}>
          <AdminCoordinationRegionDirectory
            regions={result.data.regions}
            onChanged={async () => {
              await router.invalidate();
            }}
          />
        </Suspense>
      )}
    </Stack>
  );
}
