import { Container, Stack, Text, Title } from "#/features/shared/mantine";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
import { getLearnerEventsDashboard } from "#/server/functions/learner";
import classes from "./dashboard.module.css";

const LearnerEventSection = lazy(async () => {
  const module = await import("#/features/learner/LearnerEventSection");
  return { default: module.LearnerEventSection };
});

export const Route = createFileRoute("/my-events")({
  ssr: "data-only",
  loader: async () => {
    const dashboard = await getLearnerEventsDashboard();
    if (!dashboard)
      throw redirect({
        to: "/login",
        search: { redirect: "/my-events" },
      });
    return dashboard;
  },
  component: MyEventsPage,
});

function MyEventsPage() {
  const dashboard = Route.useLoaderData();
  return (
    <Container size="lg" className={classes.section}>
      <Stack gap="xl">
        <div>
          <Text c="indigo.7" fw={700}>
            Learner area
          </Text>
          <Title order={1}>My events</Title>
        </div>
        <Suspense fallback={<LoadingSpinner label="Loading events" />}>
          <LearnerEventSection events={dashboard.events} />
        </Suspense>
      </Stack>
    </Container>
  );
}
