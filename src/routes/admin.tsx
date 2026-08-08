import { Container, Text, Title } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin")({
  ssr: false,
  component: AdminPage,
});

function AdminPage() {
  return (
    <Container size="lg" py={72}>
      <Title order={1}>Administration</Title>
      <Text mt="md">
        Client-rendered administration shell. Server functions enforce every
        authorization decision.
      </Text>
    </Container>
  );
}
