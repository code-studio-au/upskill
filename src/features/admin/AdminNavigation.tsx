import { Button, Group, Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";

export function AdminNavigation() {
  return (
    <Group justify="space-between" align="center" gap="md" wrap="wrap">
      <Text fw={800} c="indigo.8">
        Upskill administration
      </Text>
      <Group gap="xs">
        <Button component={Link} to="/admin" variant="subtle">
          Overview
        </Button>
        <Button component={Link} to="/admin/learners" variant="subtle">
          Learners
        </Button>
        <Button component={Link} to="/admin/modules" variant="subtle">
          Modules
        </Button>
        <Button component={Link} to="/dashboard" variant="light">
          Learner view
        </Button>
      </Group>
    </Group>
  );
}
