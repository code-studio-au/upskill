import { Button, Paper, Stack, Text, Title } from "#/features/shared/mantine";
import { Link } from "@tanstack/react-router";

export function AdminAccessDenied() {
  return (
    <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }} maw={640}>
      <Stack>
        <Title order={1}>Administrator access required</Title>
        <Text c="dimmed">
          Your account is signed in, but it does not have platform
          administration access.
        </Text>
        <Button component={Link} to="/dashboard" w="fit-content">
          Return to my learning
        </Button>
      </Stack>
    </Paper>
  );
}
