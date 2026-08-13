import { Container } from "#/features/shared/mantine";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import classes from "#/features/event-operations/EventOperations.module.css";

export const Route = createFileRoute("/event-operations")({
  ssr: "data-only",
  component: EventOperationsLayout,
});

function EventOperationsLayout() {
  return (
    <Container size="lg" className={classes.page}>
      <Outlet />
    </Container>
  );
}
