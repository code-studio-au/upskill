import { useForm } from "@tanstack/react-form";
import { useCallback, useEffect, useState } from "react";
import type {
  AdminCommunicationPlanItem,
  AdminCommunicationWorkspace,
  CommunicationScope,
} from "./admin-communication.schema";
import { AppDialog } from "#/features/shared/AppDialog";
import { Badge } from "#/features/shared/Badge";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
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
  getAdminCommunicationWorkspace,
  mutateAdminCommunication,
  previewAdminCommunication,
} from "#/server/functions/admin-communication";
import classes from "./AdminCommunicationPlanEditor.module.css";

interface Draft {
  label: string;
  emailDesignVersionId: string;
  sectionId: string;
  sessionDefinitionId: string;
  audience: string;
  trigger: string;
  offsetAmount: number;
  offsetUnit: "minute" | "hour" | "day" | "week";
  subjectOverride: string;
  textBodyOverride: string;
}

const courseAudiences = [
  { value: "affected_learner", label: "Affected learner" },
  { value: "active_enrollees", label: "Active enrolled learners" },
] as const;
const eventAudiences = [
  { value: "affected_learner", label: "Affected learner" },
  { value: "confirmed_participants", label: "Confirmed participants" },
  { value: "presenters", label: "Presenters" },
  { value: "coordinators", label: "Regional coordinators" },
  { value: "administrators", label: "Event administrators" },
] as const;
const courseTriggers = [
  { value: "enrollment_created", label: "Enrolment created" },
  { value: "enrollment_completed", label: "Course completed" },
  { value: "course_incomplete", label: "Course remains incomplete" },
  { value: "enrollment_expiring", label: "Enrolment expiry" },
] as const;
const eventTriggers = [
  { value: "registration_submitted", label: "Registration submitted" },
  { value: "registration_selected", label: "Registration confirmed" },
  { value: "event_start", label: "Event start" },
  { value: "event_end", label: "Event end" },
  { value: "session_start", label: "Session start" },
  { value: "section_release", label: "Section release" },
  { value: "event_completed", label: "Event completed" },
] as const;

function selectedValue<const Options extends ReadonlyArray<{ value: string }>>(
  options: Options,
  value: string,
  fallback: Options[number]["value"],
): Options[number]["value"] {
  return options.find((option) => option.value === value)?.value ?? fallback;
}

function emptyDraft(
  workspace: AdminCommunicationWorkspace,
  item?: AdminCommunicationPlanItem,
): Draft {
  return {
    label: item?.label ?? "New automated email",
    emailDesignVersionId:
      item?.emailDesignVersionId ?? workspace.templates[0]?.versionId ?? "",
    sectionId: item?.sectionId ?? "",
    sessionDefinitionId: item?.sessionDefinitionId ?? "",
    audience:
      item?.audience ??
      (workspace.scope.kind === "course"
        ? "affected_learner"
        : "confirmed_participants"),
    trigger:
      item?.trigger ??
      (workspace.scope.kind === "course" ? "course_incomplete" : "event_start"),
    offsetAmount: item?.offsetAmount ?? 0,
    offsetUnit: item?.offsetUnit ?? "day",
    subjectOverride:
      workspace.scope.kind === "event_occurrence"
        ? (item?.subject ?? "")
        : item?.subjectOverridden
          ? item.subject
          : "",
    textBodyOverride:
      workspace.scope.kind === "event_occurrence"
        ? (item?.textBody ?? "")
        : item?.textBodyOverridden
          ? item.textBody
          : "",
  };
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./u, (letter) => letter.toUpperCase());
}

function communicationScope(
  kind: CommunicationScope["kind"],
  key: string,
): CommunicationScope {
  if (kind === "course") return { kind, courseVersionId: key };
  if (kind === "event_template") return { kind, eventTemplateVersionId: key };
  return { kind, eventOccurrenceId: key };
}

export function AdminCommunicationPlanEditor({
  scope,
  onChanged,
}: {
  scope: CommunicationScope;
  onChanged?: () => Promise<void>;
}) {
  const [workspace, setWorkspace] =
    useState<AdminCommunicationWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<
    AdminCommunicationPlanItem | "new" | null
  >(null);
  const [deleting, setDeleting] = useState<AdminCommunicationPlanItem | null>(
    null,
  );
  const [preview, setPreview] = useState<{
    subject: string;
    textBody: string;
  } | null>(null);

  const scopeKey =
    scope.kind === "course"
      ? scope.courseVersionId
      : scope.kind === "event_template"
        ? scope.eventTemplateVersionId
        : scope.eventOccurrenceId;
  const load = useCallback(async () => {
    const result = await getAdminCommunicationWorkspace({
      data: communicationScope(scope.kind, scopeKey),
    });
    if (result.status === "ready") setWorkspace(result.data);
    else setError("The communication plan could not be loaded.");
    setLoading(false);
  }, [scope.kind, scopeKey]);

  const refresh = useCallback(async () => {
    await load();
    await onChanged?.();
  }, [load, onChanged]);

  useEffect(() => {
    let active = true;
    void getAdminCommunicationWorkspace({
      data: communicationScope(scope.kind, scopeKey),
    }).then((result) => {
      if (!active) return;
      if (result.status === "ready") setWorkspace(result.data);
      else setError("The communication plan could not be loaded.");
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [scope.kind, scopeKey]);

  async function previewItem(item: AdminCommunicationPlanItem) {
    setError(null);
    const result = await previewAdminCommunication({
      data: {
        scope,
        communicationId: item.id,
      },
    });
    if (result.status === "ready") setPreview(result.data);
    else setError("The email preview could not be generated.");
  }

  if (loading) return <LoadingSpinner label="Loading communications" />;
  if (!workspace) return <Alert color="red">{error}</Alert>;
  const eventOccurrenceId =
    workspace.scope.kind === "event_occurrence"
      ? workspace.scope.eventOccurrenceId
      : null;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="end">
        <Title order={2}>Communications</Title>
        {workspace.scope.editable &&
        workspace.scope.kind !== "event_occurrence" ? (
          <Button
            disabled={workspace.templates.length === 0}
            onClick={() => {
              setEditing("new");
            }}
          >
            Add automated email
          </Button>
        ) : null}
      </Group>
      {error ? <Alert color="red">{error}</Alert> : null}
      {workspace.templates.length === 0 &&
      workspace.scope.kind !== "event_occurrence" ? (
        <Alert>No compatible Offering Email is published.</Alert>
      ) : null}
      {workspace.items.length === 0 ? (
        <Alert>No automated emails configured.</Alert>
      ) : (
        <div className={classes.grid}>
          {workspace.items.map((item) => {
            const section = workspace.sections.find(
              (candidate) => candidate.id === item.sectionId,
            );
            return (
              <Paper
                key={item.id}
                withBorder
                radius="lg"
                p="md"
                className={classes.card}
              >
                <Group justify="space-between" align="start">
                  <div>
                    <Title order={3} size="h4">
                      {item.label}
                    </Title>
                    <Text size="sm" c="dimmed">
                      {item.emailDesignName} · v{item.emailDesignVersion}
                    </Text>
                  </div>
                  <Badge
                    color={
                      item.overrideState === "overridden" ? "orange" : "blue"
                    }
                  >
                    {item.overrideState === "overridden"
                      ? "Occurrence override"
                      : item.overrideState === "inherited"
                        ? "Inherited"
                        : "Offering plan"}
                  </Badge>
                </Group>
                <Text size="sm" c="dimmed">
                  {titleCase(item.audience)} · {titleCase(item.trigger)} ·{" "}
                  {item.offsetAmount} {item.offsetUnit}
                  {section ? ` · ${section.title}` : ""}
                </Text>
                <Group gap="sm">
                  <Button
                    variant="default"
                    onClick={() => void previewItem(item)}
                  >
                    Preview
                  </Button>
                  {workspace.scope.editable ? (
                    <Button
                      variant="light"
                      onClick={() => {
                        setEditing(item);
                      }}
                    >
                      {workspace.scope.kind === "event_occurrence"
                        ? "Customise"
                        : "Edit"}
                    </Button>
                  ) : null}
                  {workspace.scope.kind === "event_occurrence" &&
                  item.overrideState === "overridden" ? (
                    <Button
                      variant="light"
                      onClick={() => {
                        if (!eventOccurrenceId) return;
                        void mutateAdminCommunication({
                          data: {
                            action: "reset_occurrence",
                            payload: {
                              eventOccurrenceId,
                              logicalId: item.logicalId,
                            },
                          },
                        }).then(async (result) => {
                          if (result.status === "ready") await refresh();
                        });
                      }}
                    >
                      Reset to inherited
                    </Button>
                  ) : null}
                  {workspace.scope.kind !== "event_occurrence" &&
                  workspace.scope.editable ? (
                    <Button
                      color="red"
                      variant="subtle"
                      onClick={() => {
                        setDeleting(item);
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </Group>
              </Paper>
            );
          })}
        </div>
      )}

      {editing ? (
        <CommunicationPlanDialog
          workspace={workspace}
          {...(editing === "new" ? {} : { item: editing })}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmationDialog
          title="Remove automated email?"
          description="This removes the email from this draft communication plan. Published versions and scheduled event occurrences are unchanged."
          confirmLabel="Remove email"
          onCancel={() => {
            setDeleting(null);
          }}
          onConfirm={() => {
            if (workspace.scope.kind === "event_occurrence") return;
            const data =
              workspace.scope.kind === "course"
                ? {
                    kind: "course" as const,
                    courseVersionId: workspace.scope.courseVersionId,
                    communicationId: deleting.id,
                  }
                : {
                    kind: "event_template" as const,
                    eventTemplateVersionId:
                      workspace.scope.eventTemplateVersionId,
                    communicationId: deleting.id,
                  };
            void mutateAdminCommunication({
              data: { action: "delete", payload: data },
            }).then(async (result) => {
              if (result.status === "ready") {
                setDeleting(null);
                await refresh();
              }
            });
          }}
        />
      ) : null}

      {preview ? (
        <AppDialog
          title="Email preview"
          onClose={() => {
            setPreview(null);
          }}
        >
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {workspace.scope.title} · Example recipient
            </Text>
            <Text fw={700}>{preview.subject}</Text>
            <Text className={classes.body}>{preview.textBody}</Text>
          </Stack>
        </AppDialog>
      ) : null}
    </Stack>
  );
}

function CommunicationPlanDialog({
  workspace,
  item,
  onClose,
  onSaved,
}: {
  workspace: AdminCommunicationWorkspace;
  item?: AdminCommunicationPlanItem;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const occurrence = workspace.scope.kind === "event_occurrence";
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: emptyDraft(workspace, item),
    onSubmit: async ({ value }) => {
      setError(null);
      if (workspace.scope.kind === "event_occurrence" && item) {
        const result = await mutateAdminCommunication({
          data: {
            action: "override_occurrence",
            payload: {
              eventOccurrenceId: workspace.scope.eventOccurrenceId,
              logicalId: item.logicalId,
              subject: value.subjectOverride || item.subject,
              textBody: value.textBodyOverride || item.textBody,
              offsetAmount: value.offsetAmount,
              offsetUnit: value.offsetUnit,
            },
          },
        });
        if (result.status === "ready") {
          await onSaved();
          return;
        }
        setError("The occurrence override could not be saved.");
        return;
      }
      if (!value.emailDesignVersionId) {
        setError("Select an email template.");
        return;
      }
      const common = {
        ...(item ? { communicationId: item.id } : {}),
        label: value.label,
        emailDesignVersionId: value.emailDesignVersionId,
        sectionId: value.sectionId || null,
        sessionDefinitionId: value.sessionDefinitionId || null,
        offsetAmount: value.offsetAmount,
        offsetUnit: value.offsetUnit,
        subjectOverride: value.subjectOverride || null,
        textBodyOverride: value.textBodyOverride || null,
      };
      let result;
      if (workspace.scope.kind === "course") {
        result = await mutateAdminCommunication({
          data: {
            action: "save_course",
            payload: {
              ...common,
              courseVersionId: workspace.scope.courseVersionId,
              audience: selectedValue(
                courseAudiences,
                value.audience,
                "affected_learner",
              ),
              trigger: selectedValue(
                courseTriggers,
                value.trigger,
                "course_incomplete",
              ),
            },
          },
        });
      } else if (workspace.scope.kind === "event_template") {
        result = await mutateAdminCommunication({
          data: {
            action: "save_event_template",
            payload: {
              ...common,
              eventTemplateVersionId: workspace.scope.eventTemplateVersionId,
              audience: selectedValue(
                eventAudiences,
                value.audience,
                "confirmed_participants",
              ),
              trigger: selectedValue(
                eventTriggers,
                value.trigger,
                "event_start",
              ),
            },
          },
        });
      } else {
        setError("The occurrence communication could not be saved.");
        return;
      }
      if (result.status === "ready") {
        await onSaved();
        return;
      }
      setError("The communication plan could not be saved.");
    },
  });
  const triggers =
    workspace.scope.kind === "course" ? courseTriggers : eventTriggers;
  const audiences =
    workspace.scope.kind === "course" ? courseAudiences : eventAudiences;

  return (
    <form.Subscribe
      selector={(state) => ({
        pending: state.isSubmitting,
        values: state.values,
      })}
    >
      {({ pending, values }) => (
        <AppDialog
          title={
            occurrence
              ? "Customise occurrence email"
              : item
                ? "Edit automated email"
                : "Add automated email"
          }
          closeDisabled={pending}
          onClose={onClose}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <Stack gap="md" className={classes.dialogBody}>
              {!occurrence ? (
                <>
                  <MantineTextInput
                    label="Plan label"
                    value={values.label}
                    onChange={(event) => {
                      form.setFieldValue("label", event.currentTarget.value);
                    }}
                    required
                  />
                  <MantineNativeSelect
                    label="Email template"
                    value={values.emailDesignVersionId}
                    data={workspace.templates.map((template) => ({
                      value: template.versionId,
                      label: `${template.designName} · v${String(template.version)}`,
                    }))}
                    onChange={(event) => {
                      form.setFieldValue(
                        "emailDesignVersionId",
                        event.currentTarget.value,
                      );
                    }}
                    required
                  />
                  <MantineNativeSelect
                    label="Audience"
                    value={values.audience}
                    data={audiences}
                    onChange={(event) => {
                      form.setFieldValue("audience", event.currentTarget.value);
                    }}
                    required
                  />
                  <MantineNativeSelect
                    label="Trigger"
                    value={values.trigger}
                    data={triggers}
                    onChange={(event) => {
                      form.setFieldValue("trigger", event.currentTarget.value);
                    }}
                    required
                  />
                  <MantineNativeSelect
                    label="Section timeline"
                    value={values.sectionId}
                    data={[
                      { value: "", label: "No section" },
                      ...workspace.sections.map((section) => ({
                        value: section.id,
                        label: section.title,
                      })),
                    ]}
                    onChange={(event) => {
                      form.setFieldValue(
                        "sectionId",
                        event.currentTarget.value,
                      );
                    }}
                  />
                  {workspace.sessions.length ? (
                    <MantineNativeSelect
                      label="Session"
                      value={values.sessionDefinitionId}
                      data={[
                        { value: "", label: "No session" },
                        ...workspace.sessions.map((session) => ({
                          value: session.id,
                          label: session.title,
                        })),
                      ]}
                      onChange={(event) => {
                        form.setFieldValue(
                          "sessionDefinitionId",
                          event.currentTarget.value,
                        );
                      }}
                    />
                  ) : null}
                </>
              ) : null}
              <div className={classes.timingGrid}>
                <MantineTextInput
                  type="number"
                  label="Timing offset"
                  value={String(values.offsetAmount)}
                  onChange={(event) => {
                    form.setFieldValue(
                      "offsetAmount",
                      Number(event.currentTarget.value),
                    );
                  }}
                  required
                />
                <MantineNativeSelect
                  label="Offset unit"
                  value={values.offsetUnit}
                  data={[
                    { value: "minute", label: "Minutes" },
                    { value: "hour", label: "Hours" },
                    { value: "day", label: "Days" },
                    { value: "week", label: "Weeks" },
                  ]}
                  onChange={(event) => {
                    form.setFieldValue(
                      "offsetUnit",
                      event.currentTarget.value as Draft["offsetUnit"],
                    );
                  }}
                  required
                />
              </div>
              <MantineTextInput
                label={occurrence ? "Subject" : "Subject override"}
                value={values.subjectOverride}
                onChange={(event) => {
                  form.setFieldValue(
                    "subjectOverride",
                    event.currentTarget.value,
                  );
                }}
              />
              <MantineTextInput
                component="textarea"
                label={occurrence ? "Email body" : "Body override"}
                value={values.textBodyOverride}
                onChange={(event) => {
                  form.setFieldValue(
                    "textBodyOverride",
                    event.currentTarget.value,
                  );
                }}
              />
              {error ? <Alert color="red">{error}</Alert> : null}
              <Group justify="flex-end">
                <Button
                  type="button"
                  variant="default"
                  disabled={pending}
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={pending}>
                  Save
                </Button>
              </Group>
            </Stack>
          </form>
        </AppDialog>
      )}
    </form.Subscribe>
  );
}
