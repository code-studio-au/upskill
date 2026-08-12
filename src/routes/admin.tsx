import { Container } from "#/features/shared/mantine";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminNavigation } from "#/features/admin/AdminNavigation";
import classes from "./admin.module.css";

export const Route = createFileRoute("/admin")({
  ssr: false,
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <Container fluid className={classes.page}>
      <div className={classes.adminShell}>
        <AdminNavigation />
        <div className={classes.adminContent}>
          <Outlet />
        </div>
      </div>
    </Container>
  );
}
