import { Stack, Text, Title } from "@mantine/core";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { AdminResourceLibrary } from "#/features/resource/AdminResourceLibrary";
import { getAdminResources } from "#/server/functions/admin-resource";
import classes from "./admin.module.css";

export const Route = createFileRoute("/admin/resources")({
  ssr: false,
  loader: async () => {
    const result = await getAdminResources();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/resources" },
      });
    return result;
  },
  component: AdminResourcesPage,
});

function AdminResourcesPage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const refresh = useCallback(async () => {
    await router.invalidate();
  }, [router]);
  if (result.status === "forbidden") return <AdminAccessDenied />;

  return (
    <Stack gap="xl">
      <div className={classes.heading}>
        <Text c="indigo.7" fw={700}>
          Learning content
        </Text>
        <Title order={1}>PDF resources</Title>
        <Text c="dimmed" mt="xs">
          Manage private, immutable document versions for course sections.
          Referenced versions remain protected with their learner history.
        </Text>
      </div>
      <AdminResourceLibrary resources={result.data} onChanged={refresh} />
    </Stack>
  );
}
