import { Button, Group, Stack, Text, Title } from "#/features/shared/mantine";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { AdminScormModuleLibrary } from "#/features/scorm/AdminScormModuleLibrary";
import { isScormVerificationPending } from "#/features/scorm/scorm-package.schema";
import { getAdminScormPackages } from "#/server/functions/admin-scorm";
import classes from "./admin.module.css";
import { AppDialog } from "#/features/shared/AppDialog";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";

const AdminScormUploadPanel = lazy(async () => {
  const module = await import("#/features/scorm/AdminScormUploadPanel");
  return { default: module.AdminScormUploadPanel };
});

export const Route = createFileRoute("/admin/modules")({
  ssr: false,
  loader: async () => {
    const result = await getAdminScormPackages();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/modules" },
      });
    return result;
  },
  component: AdminModulesPage,
});

function AdminModulesPage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false);
  const packages = result.status === "ready" ? result.data : [];
  const hasPendingVerification = packages.some((item) =>
    item.versions.some((version) => isScormVerificationPending(version.status)),
  );
  const refresh = useCallback(async (): Promise<void> => {
    await router.invalidate();
  }, [router]);

  useEffect(() => {
    if (!hasPendingVerification) return;
    let refreshing = false;
    const timer = window.setInterval(() => {
      if (refreshing) return;
      refreshing = true;
      void refresh().finally(() => {
        refreshing = false;
      });
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasPendingVerification, refresh]);

  if (result.status === "forbidden") return <AdminAccessDenied />;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="end" wrap="wrap">
        <div className={classes.heading}>
          <Text c="indigo.7" fw={700}>
            Learning content
          </Text>
          <Title order={1}>SCORM modules</Title>
          <Text c="dimmed" mt="xs">
            Manage immutable Rise 360 SCORM 1.2 packages and versions.
          </Text>
        </div>
        <Button
          onClick={() => {
            setUploadOpen(true);
          }}
        >
          Upload module
        </Button>
      </Group>
      <AdminScormModuleLibrary packages={packages} onChanged={refresh} />
      {uploadOpen ? (
        <AppDialog
          title="Upload SCORM module"
          size="lg"
          onClose={() => {
            setUploadOpen(false);
          }}
        >
          <Suspense fallback={<LoadingSpinner label="Loading upload form" />}>
            <AdminScormUploadPanel
              packages={packages}
              onChanged={async () => {
                await refresh();
                setUploadOpen(false);
              }}
            />
          </Suspense>
        </AppDialog>
      ) : null}
    </Stack>
  );
}
