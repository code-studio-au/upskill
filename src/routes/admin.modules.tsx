import { Stack, Text, Title } from "@mantine/core";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { AdminScormModuleLibrary } from "#/features/scorm/AdminScormModuleLibrary";
import { AdminScormUploadPanel } from "#/features/scorm/AdminScormUploadPanel";
import { isScormVerificationPending } from "#/features/scorm/scorm-package.schema";
import { getAdminScormPackages } from "#/server/functions/admin-scorm";
import classes from "./admin.module.css";

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
    <Stack gap="xl">
      <div className={classes.heading}>
        <Text c="indigo.7" fw={700}>
          Learning content
        </Text>
        <Title order={1}>SCORM modules</Title>
        <Text c="dimmed" mt="xs">
          Upload a Rise 360 SCORM 1.2 ZIP. New versions preserve existing
          learner history and become available for future course versions only.
        </Text>
      </div>
      <AdminScormUploadPanel packages={packages} onChanged={refresh} />
      <AdminScormModuleLibrary packages={packages} onChanged={refresh} />
    </Stack>
  );
}
