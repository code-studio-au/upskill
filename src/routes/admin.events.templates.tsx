import { useState } from "react";
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { Badge } from "#/features/shared/Badge";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import {
  getAdminEventWorkspace,
  startAdminEventTemplate,
} from "#/server/functions/admin-event";
import classes from "./admin.events.module.css";

export const Route = createFileRoute("/admin/events/templates")({
  ssr: false,
  loader: async () => {
    const result = await getAdminEventWorkspace();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/events/templates" },
      });
    return result;
  },
  component: EventTemplatesPage,
});

function EventTemplatesPage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (result.status === "forbidden") return <AdminAccessDenied />;

  async function startTemplate() {
    setCreating(true);
    setError(null);
    try {
      const outcome = await startAdminEventTemplate();
      if (outcome.status !== "ready" || !outcome.data.eventTemplateId) {
        setError("The draft event template could not be started.");
        return;
      }
      await router.navigate({
        to: "/admin/events/$eventTemplateId",
        params: { eventTemplateId: outcome.data.eventTemplateId },
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Text c="indigo.7" fw={700}>
            Events
          </Text>
          <Title order={1}>Event templates</Title>
        </div>
        <Button loading={creating} onClick={() => void startTemplate()}>
          Create template
        </Button>
      </Group>

      {error ? <Alert color="red">{error}</Alert> : null}

      {result.data.templates.length === 0 ? (
        <Alert title="No event templates">
          Create the first reusable event template.
        </Alert>
      ) : (
        <div className={classes.cardGrid}>
          {result.data.templates.map((template) => (
            <Paper
              component="article"
              key={template.id}
              withBorder
              radius="lg"
              p="md"
            >
              <Stack gap="md">
                <Group justify="space-between" align="start" wrap="nowrap">
                  <Link
                    to="/admin/events/$eventTemplateId"
                    params={{ eventTemplateId: template.id }}
                    className={classes.cardTitleLink}
                  >
                    <Title order={3}>{template.title}</Title>
                  </Link>
                  <Group gap="xs" wrap="wrap" justify="flex-end">
                    {template.status === "archived" ? (
                      <Badge color="gray">
                        Archived v
                        {template.publishedVersion ?? template.latestVersion}
                      </Badge>
                    ) : (
                      <>
                        {template.publishedVersion ? (
                          <Badge color="green">
                            Published v{template.publishedVersion}
                          </Badge>
                        ) : null}
                        {template.draftVersionId ? (
                          <Badge color="gray">
                            Draft v{template.latestVersion}
                          </Badge>
                        ) : null}
                      </>
                    )}
                  </Group>
                </Group>
                <Text size="sm">
                  {template.occurrenceCount} scheduled event
                  {template.occurrenceCount === 1 ? "" : "s"}
                </Text>
              </Stack>
            </Paper>
          ))}
        </div>
      )}
    </Stack>
  );
}
