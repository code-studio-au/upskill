import { Group, Stack, Text, Title } from "@mantine/core";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { Badge } from "#/features/shared/Badge";
import type {
  AdminAccessGrantDirectory as AccessGrantDirectory,
  AdminAccessGrantResult,
} from "./admin-access.schema";
import { AdminAccessGrantDirectory } from "./AdminAccessGrantDirectory";
import { AdminAccessGrantForm } from "./AdminAccessGrantForm";

interface AdminAccessGrantManagerProps {
  result: AdminAccessGrantResult<AccessGrantDirectory>;
}

export function AdminAccessGrantManager({
  result,
}: AdminAccessGrantManagerProps) {
  if (result.status === "forbidden") return <AdminAccessDenied />;
  if (result.status === "unauthenticated") return null;
  return (
    <Stack gap="xl">
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Text c="indigo.7" fw={700}>
            Organisation access
          </Text>
          <Title order={1}>Access grants</Title>
          <Text c="dimmed" mt="xs">
            Issue capacity-limited codes for exact published course versions and
            optional verified-email domains.
          </Text>
        </div>
        <Badge color="blue" variant="light">
          {result.data.grants.length}{" "}
          {result.data.grants.length === 1 ? "grant" : "grants"}
        </Badge>
      </Group>
      <AdminAccessGrantForm targets={result.data.targets} />
      <AdminAccessGrantDirectory grants={result.data.grants} />
    </Stack>
  );
}
