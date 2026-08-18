import { createFileRoute, redirect } from "@tanstack/react-router";
import { Alert, Container } from "#/features/shared/mantine";
import { AccessOwnerDashboard } from "#/features/access-owner/AccessOwnerDashboard";
import { getAccessOwnerDashboard } from "#/server/functions/access-owner";

export const Route = createFileRoute("/access-management")({
  ssr: "data-only",
  loader: async () => {
    const result = await getAccessOwnerDashboard();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/access-management" },
      });
    return result;
  },
  component: AccessManagementPage,
});

function AccessManagementPage() {
  const result = Route.useLoaderData();
  if (result.status !== "ready")
    return (
      <Container size="lg">
        <Alert color="red">
          You do not have an active Access Owner assignment.
        </Alert>
      </Container>
    );
  return <AccessOwnerDashboard dashboard={result.data} />;
}
