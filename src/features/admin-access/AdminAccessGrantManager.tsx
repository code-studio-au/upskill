import { Button, Group, Stack, Text, Title } from "#/features/shared/mantine";
import { useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { Badge } from "#/features/shared/Badge";
import type {
  AdminAccessGrantDirectory as AccessGrantDirectory,
  AdminAccessGrantResult,
} from "./admin-access.schema";
import { AdminAccessGrantDirectory } from "./AdminAccessGrantDirectory";
import { AdminAccessGrantForm } from "./AdminAccessGrantForm";
import { AppDialog } from "#/features/shared/AppDialog";

interface AdminAccessGrantManagerProps {
  result: AdminAccessGrantResult<AccessGrantDirectory>;
}

export function AdminAccessGrantManager({
  result,
}: AdminAccessGrantManagerProps) {
  const [createOpen, setCreateOpen] = useState(false);
  if (result.status === "forbidden") return <AdminAccessDenied />;
  if (result.status === "unauthenticated") return null;
  return (
    <Stack gap="lg">
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
        <Group gap="sm">
          <Badge color="blue" variant="light">
            {result.data.grants.length}{" "}
            {result.data.grants.length === 1 ? "grant" : "grants"}
          </Badge>
          <Button
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            Create grant
          </Button>
        </Group>
      </Group>
      <AdminAccessGrantDirectory grants={result.data.grants} />
      {createOpen ? (
        <AppDialog
          title="Create access grant"
          size="lg"
          onClose={() => {
            setCreateOpen(false);
          }}
        >
          <AdminAccessGrantForm
            targets={result.data.targets}
            onDone={() => {
              setCreateOpen(false);
            }}
          />
        </AppDialog>
      ) : null}
    </Stack>
  );
}
