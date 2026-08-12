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
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import type { AdminEventWorkspace } from "#/features/admin-event/admin-event.schema";
import { formatLocalDateTime } from "#/features/shared/local-date";
import {
  getAdminEventWorkspace,
  publishAdminEventOccurrence,
  startAdminEventTemplate,
} from "#/server/functions/admin-event";
import classes from "./admin.events.module.css";
import { PageTabs } from "#/features/shared/PageTabs";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
import { z } from "#/validation/zod";

const adminEventsSearchSchema = z.object({
  view: z.catch(z.enum(["occurrences", "templates"]), "occurrences"),
});

const AdminEventOccurrenceDialog = lazy(async () => {
  const module =
    await import("#/features/admin-event/AdminEventOccurrenceDialog");
  return { default: module.AdminEventOccurrenceDialog };
});

export const Route = createFileRoute("/admin/events/")({
  validateSearch: adminEventsSearchSchema,
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
  return formatLocalDateTime(value, { timeZone: timezone });
}

function readable(value: string): string {
  return value.replaceAll("_", " ");
}

function AdminEventsPage() {
  const result = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const [occurrenceDialogOpen, setOccurrenceDialogOpen] = useState(false);
  const [editingOccurrence, setEditingOccurrence] = useState<
    AdminEventWorkspace["occurrences"][number] | null
  >(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (result.status === "forbidden") return <AdminAccessDenied />;
  const workspace = result.data;

  async function refresh(closeDialogs = false) {
    await router.invalidate();
    if (closeDialogs) {
      setOccurrenceDialogOpen(false);
      setEditingOccurrence(null);
    }
  }

  async function startTemplate() {
    setCreatingTemplate(true);
    setError(null);
    try {
      const result = await startAdminEventTemplate();
      if (result.status !== "ready" || !result.data.eventTemplateId) {
        setError("The draft event template could not be started.");
        return;
      }
      await router.navigate({
        to: "/admin/events/$eventTemplateId",
        params: { eventTemplateId: result.data.eventTemplateId },
      });
    } finally {
      setCreatingTemplate(false);
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
    <Stack gap="lg">
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Text c="indigo.7" fw={700}>
            Instructor-led learning
          </Text>
          <Title order={1}>Events</Title>
          <Text c="dimmed" mt="xs" maw={760}>
            Create immutable event templates, then schedule exact-version
            in-person or virtual occurrences.
          </Text>
        </div>
        {search.view === "templates" ? (
          <Button
            loading={creatingTemplate}
            onClick={() => void startTemplate()}
          >
            Create template
          </Button>
        ) : (
          <Button
            disabled={workspace.publishedVersions.length === 0}
            onClick={() => {
              setEditingOccurrence(null);
              setOccurrenceDialogOpen(true);
            }}
          >
            Schedule occurrence
          </Button>
        )}
      </Group>

      {error ? <Alert color="red">{error}</Alert> : null}

      <PageTabs
        label="Event workspace"
        value={search.view}
        tabs={[
          {
            value: "occurrences",
            label: `Event instances (${String(workspace.occurrences.length)})`,
          },
          {
            value: "templates",
            label: `Templates (${String(workspace.templates.length)})`,
          },
        ]}
        onChange={(view) => void navigate({ search: { view } })}
      />

      {search.view === "templates" ? (
        <section aria-labelledby="event-templates-heading">
          <Stack gap="md">
            <div>
              <Title order={2} id="event-templates-heading">
                Event templates
              </Title>
              <Text c="dimmed" size="sm">
                Published versions remain stable for every occurrence created
                from them.
              </Text>
            </div>
            {workspace.templates.length === 0 ? (
              <Alert title="No event templates">
                Create the first reusable event template.
              </Alert>
            ) : (
              <div className={classes.cardGrid}>
                {workspace.templates.map((template) => (
                  <Paper key={template.id} withBorder radius="lg" p="md">
                    <Stack gap="md">
                      <Group
                        justify="space-between"
                        align="start"
                        wrap="nowrap"
                      >
                        <div>
                          <Title order={3}>{template.title}</Title>
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
                      <Button
                        variant="light"
                        onClick={() => {
                          void router.navigate({
                            to: "/admin/events/$eventTemplateId",
                            params: { eventTemplateId: template.id },
                          });
                        }}
                      >
                        {template.draftVersionId
                          ? `Edit version ${String(template.latestVersion)}`
                          : "Open template"}
                      </Button>
                    </Stack>
                  </Paper>
                ))}
              </div>
            )}
          </Stack>
        </section>
      ) : (
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
                  <Paper
                    component="article"
                    key={occurrence.id}
                    withBorder
                    radius="lg"
                    p="md"
                  >
                    <Stack gap="sm">
                      <Group
                        justify="space-between"
                        align="start"
                        wrap="nowrap"
                      >
                        <div>
                          <Title order={3}>{occurrence.title}</Title>
                          <Text size="sm" c="dimmed">
                            {occurrence.eventTemplateTitle} · Version{" "}
                            {occurrence.templateVersion}
                          </Text>
                          <Text size="sm" c="dimmed">
                            /events/{occurrence.slug}
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
                        {formatEventDate(
                          occurrence.endsAt,
                          occurrence.timezone,
                        )}
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
                      <Group grow wrap="wrap">
                        <Button
                          variant="light"
                          onClick={() => {
                            setEditingOccurrence(occurrence);
                          }}
                        >
                          Open instance
                        </Button>
                        {occurrence.status === "draft" ? (
                          <Button
                            loading={processingId === occurrence.id}
                            onClick={() => {
                              void publishOccurrence(occurrence.id);
                            }}
                          >
                            Publish occurrence
                          </Button>
                        ) : null}
                      </Group>
                    </Stack>
                  </Paper>
                ))}
              </div>
            )}
          </Stack>
        </section>
      )}

      <Suspense fallback={<LoadingSpinner label="Loading event editor" />}>
        {occurrenceDialogOpen || editingOccurrence ? (
          <AdminEventOccurrenceDialog
            publishedVersions={workspace.publishedVersions}
            {...(editingOccurrence ? { occurrence: editingOccurrence } : {})}
            onClose={() => {
              setOccurrenceDialogOpen(false);
              setEditingOccurrence(null);
            }}
            onSaved={async () => {
              await refresh(true);
            }}
          />
        ) : null}
      </Suspense>
    </Stack>
  );
}
