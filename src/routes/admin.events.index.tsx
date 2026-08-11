import { Badge } from "#/features/shared/Badge";
import {
  Alert,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import {
  getAdminEventWorkspace,
  publishAdminEventOccurrence,
  publishAdminEventTemplate,
} from "#/server/functions/admin-event";
import classes from "./admin.events.module.css";

const AdminEventOccurrenceDialog = lazy(async () => {
  const module =
    await import("#/features/admin-event/AdminEventOccurrenceDialog");
  return { default: module.AdminEventOccurrenceDialog };
});

const AdminEventTemplateDialog = lazy(async () => {
  const module =
    await import("#/features/admin-event/AdminEventTemplateDialog");
  return { default: module.AdminEventTemplateDialog };
});

export const Route = createFileRoute("/admin/events/")({
  ssr: false,
  loader: async () => {
    const result = await getAdminEventWorkspace();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/events" },
      });
    return result;
  },
  component: AdminEventsPage,
});

function formatEventDate(value: string, timezone: string): string {
  return new Date(value).toLocaleString("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });
}

function readable(value: string): string {
  return value.replaceAll("_", " ");
}

function AdminEventsPage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [occurrenceDialogOpen, setOccurrenceDialogOpen] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (result.status === "forbidden") return <AdminAccessDenied />;
  const workspace = result.data;

  async function refresh(closeDialogs = false) {
    await router.invalidate();
    if (closeDialogs) {
      setTemplateDialogOpen(false);
      setOccurrenceDialogOpen(false);
    }
  }

  async function publishTemplate(
    eventTemplateId: string,
    eventTemplateVersionId: string,
  ) {
    setProcessingId(eventTemplateVersionId);
    setError(null);
    try {
      const outcome = await publishAdminEventTemplate({
        data: { eventTemplateId, eventTemplateVersionId },
      });
      if (outcome.status !== "ready") {
        setError(
          "The template cannot be published until every required administrator, region and presenter scope has coverage.",
        );
        return;
      }
      await refresh();
    } finally {
      setProcessingId(null);
    }
  }

  async function publishOccurrence(eventOccurrenceId: string) {
    setProcessingId(eventOccurrenceId);
    setError(null);
    try {
      const outcome = await publishAdminEventOccurrence({
        data: { eventOccurrenceId },
      });
      if (outcome.status !== "ready") {
        setError(
          "The occurrence cannot be published until schedule, location, domains and staff coverage are complete.",
        );
        return;
      }
      await refresh();
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Text c="indigo.7" fw={700}>
            Instructor-led learning
          </Text>
          <Title order={1}>Events</Title>
          <Text c="dimmed" mt="xs" maw={760}>
            Create immutable event templates, then schedule exact-version
            in-person, virtual or hybrid occurrences.
          </Text>
        </div>
        <Group>
          <Button
            variant="light"
            onClick={() => {
              setTemplateDialogOpen(true);
            }}
          >
            Create template
          </Button>
          <Button
            disabled={workspace.publishedVersions.length === 0}
            onClick={() => {
              setOccurrenceDialogOpen(true);
            }}
          >
            Schedule occurrence
          </Button>
        </Group>
      </Group>

      {error ? <Alert color="red">{error}</Alert> : null}

      <section aria-labelledby="event-templates-heading">
        <Stack gap="md">
          <div>
            <Title order={2} id="event-templates-heading">
              Event templates
            </Title>
            <Text c="dimmed" size="sm">
              Published versions remain stable for every occurrence created from
              them.
            </Text>
          </div>
          {workspace.templates.length === 0 ? (
            <Alert title="No event templates">
              Create the first reusable event template.
            </Alert>
          ) : (
            <div className={classes.cardGrid}>
              {workspace.templates.map((template) => (
                <Paper key={template.id} withBorder radius="lg" p="lg">
                  <Stack gap="md">
                    <Group justify="space-between" align="start" wrap="nowrap">
                      <div>
                        <Title order={3}>{template.title}</Title>
                        <Text size="sm" c="dimmed">
                          /events/{template.slug}
                        </Text>
                      </div>
                      <Badge
                        color={
                          template.status === "published" ? "green" : "gray"
                        }
                        variant="light"
                      >
                        {template.status}
                      </Badge>
                    </Group>
                    <Text size="sm">
                      Latest version {template.latestVersion} ·{" "}
                      {template.occurrenceCount} occurrence
                      {template.occurrenceCount === 1 ? "" : "s"}
                    </Text>
                    {template.draftVersionId ? (
                      <Button
                        variant="light"
                        loading={processingId === template.draftVersionId}
                        onClick={() => {
                          const draftVersionId = template.draftVersionId;
                          if (draftVersionId)
                            void publishTemplate(template.id, draftVersionId);
                        }}
                      >
                        Publish version {template.latestVersion}
                      </Button>
                    ) : (
                      <Text size="sm" c="dimmed">
                        Published version {template.publishedVersion}
                      </Text>
                    )}
                  </Stack>
                </Paper>
              ))}
            </div>
          )}
        </Stack>
      </section>

      <section aria-labelledby="event-occurrences-heading">
        <Stack gap="md">
          <div>
            <Title order={2} id="event-occurrences-heading">
              Scheduled occurrences
            </Title>
            <Text c="dimmed" size="sm">
              Each occurrence is pinned to one exact template version and owns
              its schedule, capacity, registration policy and staff snapshots.
            </Text>
          </div>
          {workspace.occurrences.length === 0 ? (
            <Alert title="No occurrences scheduled">
              Publish a template, then schedule its first occurrence.
            </Alert>
          ) : (
            <div className={classes.cardGrid}>
              {workspace.occurrences.map((occurrence) => (
                <Paper key={occurrence.id} withBorder radius="lg" p="lg">
                  <Stack gap="sm">
                    <Group justify="space-between" align="start" wrap="nowrap">
                      <div>
                        <Title order={3}>{occurrence.title}</Title>
                        <Text size="sm" c="dimmed">
                          {occurrence.eventTemplateTitle} · Version{" "}
                          {occurrence.templateVersion}
                        </Text>
                      </div>
                      <Badge
                        color={
                          occurrence.status === "published" ? "green" : "gray"
                        }
                        variant="light"
                      >
                        {occurrence.status}
                      </Badge>
                    </Group>
                    <Text size="sm">
                      {formatEventDate(
                        occurrence.startsAt,
                        occurrence.timezone,
                      )}
                      {" – "}
                      {formatEventDate(occurrence.endsAt, occurrence.timezone)}
                      {" · "}
                      {occurrence.timezone}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {readable(occurrence.deliveryMode)} ·{" "}
                      {readable(occurrence.registrationMode)} · capacity{" "}
                      {occurrence.confirmedCount}/{occurrence.capacity}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {occurrence.sessionCount} session
                      {occurrence.sessionCount === 1 ? "" : "s"} ·{" "}
                      {occurrence.assignedAdminCount} assigned administrator
                      {occurrence.assignedAdminCount === 1 ? "" : "s"}
                    </Text>
                    {occurrence.status === "draft" ? (
                      <Button
                        variant="light"
                        loading={processingId === occurrence.id}
                        onClick={() => {
                          void publishOccurrence(occurrence.id);
                        }}
                      >
                        Publish occurrence
                      </Button>
                    ) : null}
                  </Stack>
                </Paper>
              ))}
            </div>
          )}
        </Stack>
      </section>

      <Suspense
        fallback={
          <Center role="status" aria-label="Loading event editor">
            <Loader size="sm" />
          </Center>
        }
      >
        {templateDialogOpen ? (
          <AdminEventTemplateDialog
            onClose={() => {
              setTemplateDialogOpen(false);
            }}
            onCreated={async () => {
              await refresh(true);
            }}
          />
        ) : null}
        {occurrenceDialogOpen ? (
          <AdminEventOccurrenceDialog
            publishedVersions={workspace.publishedVersions}
            onClose={() => {
              setOccurrenceDialogOpen(false);
            }}
            onCreated={async () => {
              await refresh(true);
            }}
          />
        ) : null}
      </Suspense>
    </Stack>
  );
}
