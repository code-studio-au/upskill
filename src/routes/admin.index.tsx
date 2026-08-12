import { Paper, Stack, Text, Title } from "#/features/shared/mantine";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { getAdminOverview } from "#/server/functions/admin";
import classes from "./admin.module.css";

export const Route = createFileRoute("/admin/")({
  loader: async () => {
    const result = await getAdminOverview();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin" },
      });
    return result;
  },
  component: AdminPage,
});

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

function AdminPage() {
  const result = Route.useLoaderData();
  if (result.status === "forbidden") return <AdminAccessDenied />;

  const { administrator, statistics } = result.data;
  const stats = [
    { label: "Registered learners", value: statistics.learners },
    { label: "Active enrolments", value: statistics.activeEnrollments },
    { label: "Completed enrolments", value: statistics.completedEnrollments },
    { label: "Paid orders", value: statistics.paidOrders },
    {
      label: "Paid revenue",
      value: currency.format(statistics.paidRevenueCents / 100),
    },
  ];

  return (
    <Stack gap="lg">
      <div className={classes.heading}>
        <Text c="indigo.7" fw={700}>
          System overview
        </Text>
        <Title order={1}>Administration</Title>
        <Text c="dimmed" mt="xs">
          Signed in as {administrator.name} ({administrator.email}).
        </Text>
      </div>
      <section aria-labelledby="statistics-heading">
        <Stack gap="md">
          <Title order={2} id="statistics-heading">
            Current platform activity
          </Title>
          <div className={classes.statsGrid}>
            {stats.map((stat) => (
              <Paper
                withBorder
                radius="lg"
                p="md"
                className={classes.stat}
                key={stat.label}
              >
                <Text c="dimmed" size="sm">
                  {stat.label}
                </Text>
                <Text className={classes.statValue} mt="xs">
                  {stat.value}
                </Text>
              </Paper>
            ))}
          </div>
        </Stack>
      </section>
    </Stack>
  );
}
