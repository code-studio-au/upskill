import { Button, Group, Stack, Text, Title } from "#/features/shared/mantine";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import {
  AdminResourceLibrary,
  AdminResourceUpload,
} from "#/features/resource/AdminResourceLibrary";
import { getAdminResources } from "#/server/functions/admin-resource";
import classes from "./admin.module.css";
import { AppDialog } from "#/features/shared/AppDialog";

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
  const [uploadOpen, setUploadOpen] = useState(false);
  const refresh = useCallback(async () => {
    await router.invalidate();
  }, [router]);
  if (result.status === "forbidden") return <AdminAccessDenied />;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="end" wrap="wrap">
        <div className={classes.heading}>
          <Text c="indigo.7" fw={700}>
            Learning content
          </Text>
          <Title order={1}>PDF resources</Title>
          <Text c="dimmed" mt="xs">
            Manage private, immutable documents used by learning activities.
          </Text>
        </div>
        <Button
          onClick={() => {
            setUploadOpen(true);
          }}
        >
          Upload PDF
        </Button>
      </Group>
      <AdminResourceLibrary resources={result.data} onChanged={refresh} />
      {uploadOpen ? (
        <AppDialog
          title="Upload PDF resource"
          size="lg"
          onClose={() => {
            setUploadOpen(false);
          }}
        >
          <AdminResourceUpload
            resources={result.data}
            onChanged={async () => {
              await refresh();
              setUploadOpen(false);
            }}
          />
        </AppDialog>
      ) : null}
    </Stack>
  );
}
