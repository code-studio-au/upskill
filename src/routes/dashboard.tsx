import { Container, Skeleton, Stack, Text, Title } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard")({
  ssr: "data-only",
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <Container size="lg" py={{ base: 40, sm: 72 }}>
      <Stack gap="xl">
        <div>
          <Text c="indigo.7" fw={700}>
            Learner area
          </Text>
          <Title order={1}>My learning</Title>
        </div>
        <Skeleton height={160} radius="lg" visible={false}>
          <Text p="xl">Authentication and enrolment data connect here.</Text>
        </Skeleton>
      </Stack>
    </Container>
  );
}
