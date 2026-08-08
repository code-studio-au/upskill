import { Button, Container, Text, Title } from "@mantine/core";
import { Link } from "@tanstack/react-router";

export function NotFoundPage() {
  return (
    <Container size="sm" py={{ base: 64, sm: 96 }}>
      <Text c="indigo.7" fw={700}>
        404
      </Text>
      <Title order={1}>That page is not here</Title>
      <Text c="dimmed" mt="md">
        The address may have changed, or the content may no longer be available.
      </Text>
      <Button component={Link} to="/courses" mt="xl">
        Browse courses
      </Button>
    </Container>
  );
}
