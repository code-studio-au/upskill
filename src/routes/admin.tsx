import { Container, Stack } from "@mantine/core";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminNavigation } from "#/features/admin/AdminNavigation";
import classes from "./admin.module.css";

export const Route = createFileRoute("/admin")({
  ssr: false,
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <Container size="xl" className={classes.page}>
      <Stack gap="xl">
        <AdminNavigation />
        <Outlet />
      </Stack>
    </Container>
  );
}
