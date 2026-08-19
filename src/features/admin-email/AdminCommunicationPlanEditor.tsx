import { useForm } from "@tanstack/react-form";
import { useCallback, useEffect, useState } from "react";
import type {
  AdminCommunicationPlanItem,
  AdminCommunicationWorkspace,
  CommunicationScope,
} from "./admin-communication.schema";
import { EmailBodyEditor } from "./EmailBodyEditor";
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
  templateId: string;
  sectionId: string;
  sessionId: string;
  audience: string;
  trigger: string;
  offsetAmount: number;
  offsetUnit: "minute" | "hour" | "day" | "week";
  subject: string;
  textBody: string;
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

function emptyDraft(
  workspace: AdminCommunicationWorkspace,
  item?: AdminCommunicationPlanItem,
): Draft {
  const template = workspace.templates.find(
    (candidate) =>
      candidate.versionId ===
      (item?.emailDesignVersionId ?? workspace.templates[0]?.versionId),
  );
  return {
    label: item?.label ?? "New automated email",
    templateId:
      item?.emailDesignVersionId ?? workspace.templates[0]?.versionId ?? "",
    sectionId: item?.sectionId ?? "",
    sessionId: item?.sessionDefinitionId ?? "",
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
    subject: item?.subject ?? template?.subject ?? "",
    textBody: item?.textBody ?? template?.textBody ?? "",
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
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<
    AdminCommunicationPlanItem | "new" | null
  >(null);
  const [deleting, setDeleting] = useState<AdminCommunicationPlanItem | null>(
    null,
  );

  const scopeKey =
    scope.kind === "course"
      ? scope.courseVersionId
      : scope.kind === "event_template"
        ? scope.eventTemplateVersionId
        : scope.eventOccurrenceId;
  const requestWorkspace = useCallback(() => {
    return getAdminCommunicationWorkspace({
      data: communicationScope(scope.kind, scopeKey),
    });
  }, [scope.kind, scopeKey]);
  const load = useCallback(async () => {
    const result = await requestWorkspace();
    if (result.status === "ready") setWorkspace(result.data);
    else setError("The communication plan could not be loaded.");
  }, [requestWorkspace]);

  const refresh = useCallback(async () => {
    await load();
    await onChanged?.();
  }, [load, onChanged]);

  useEffect(() => {
    let active = true;
    void requestWorkspace().then((result) => {
      if (!active) return;
      if (result.status === "ready") setWorkspace(result.data);
      else setError("The communication plan could not be loaded.");
    });
    return () => {
      active = false;
    };
  }, [requestWorkspace]);

  if (!workspace)
    return error ? (
      <Alert color="red">{error}</Alert>
    ) : (
      <LoadingSpinner label="Loading communications" />
    );
  if (editing) {
    return (
      <CommunicationPlanForm
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
    );
  }

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
                    variant={workspace.scope.editable ? "light" : "default"}
                    onClick={() => {
                      setEditing(item);
                    }}
                  >
                    {workspace.scope.editable
                      ? workspace.scope.kind === "event_occurrence"
                        ? "Customise"
                        : "Edit"
                      : "Preview"}
                  </Button>
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
    </Stack>
  );
}

function CommunicationPlanForm({
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
  const [preview, setPreview] = useState<{
    subject: string;
    textBody: string;
  } | null>(null);
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
              subject: value.subject,
              textBody: value.textBody,
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
      if (!value.templateId) {
        setError("Select an email template.");
        return;
      }
      const selectedTemplate = workspace.templates.find(
        (template) => template.versionId === value.templateId,
      );
      if (!selectedTemplate) {
        setError("The selected email template is unavailable.");
        return;
      }
      const common = {
        ...(item ? { communicationId: item.id } : {}),
        label: value.label,
        emailDesignVersionId: value.templateId,
        sectionId: value.sectionId || null,
        sessionDefinitionId: value.sessionId || null,
        offsetAmount: value.offsetAmount,
        offsetUnit: value.offsetUnit,
        subjectOverride:
          value.subject === selectedTemplate.subject ? null : value.subject,
        textBodyOverride:
          value.textBody === selectedTemplate.textBody ? null : value.textBody,
      };
      let result;
      if (workspace.scope.kind === "course") {
        result = await mutateAdminCommunication({
          data: {
            action: "save_course",
            payload: {
              ...common,
              courseVersionId: workspace.scope.courseVersionId,
              audience:
                value.audience as (typeof courseAudiences)[number]["value"],
              trigger:
                value.trigger as (typeof courseTriggers)[number]["value"],
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
              audience:
                value.audience as (typeof eventAudiences)[number]["value"],
              trigger: value.trigger as (typeof eventTriggers)[number]["value"],
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

  async function loadPreview(values: Draft) {
    if (!values.subject.trim() || !values.textBody.trim()) {
      setError("Enter a subject and email body before previewing.");
      return;
    }
    setError(null);
    const result = await previewAdminCommunication({
      data: {
        scope: workspace.scope,
        ...(item ? { communicationId: item.id } : {}),
        emailDesignVersionId: values.templateId,
        subject: values.subject,
        textBody: values.textBody,
      },
    });
    if (result.status === "ready") setPreview(result.data);
    else setError("The email preview could not be generated.");
  }

  return (
    <form.Subscribe
      selector={(state) => ({
        pending: state.isSubmitting,
        values: state.values,
      })}
    >
      {({ pending, values }) => {
        return (
          <Stack gap="lg">
            <Group justify="space-between" align="center">
              <Title order={2}>
                {!workspace.scope.editable
                  ? "Preview automated email"
                  : occurrence
                    ? "Customise occurrence email"
                    : item
                      ? "Edit automated email"
                      : "Add automated email"}
              </Title>
              <Button variant="default" disabled={pending} onClick={onClose}>
                Back to communications
              </Button>
            </Group>
            {error ? <Alert color="red">{error}</Alert> : null}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void form.handleSubmit();
              }}
            >
              <Stack gap="lg">
                <Paper withBorder radius="lg" p="md">
                  <Stack gap="md">
                    <Title order={3} size="h4">
                      Delivery
                    </Title>
                    {!occurrence ? (
                      <>
                        <MantineTextInput
                          label="Plan label"
                          value={values.label}
                          onChange={(event) => {
                            form.setFieldValue(
                              "label",
                              event.currentTarget.value,
                            );
                          }}
                          required
                        />
                        <MantineNativeSelect
                          label="Email template"
                          value={values.templateId}
                          data={workspace.templates.map((template) => ({
                            value: template.versionId,
                            label: `${template.designName} · v${String(template.version)}`,
                          }))}
                          onChange={(event) => {
                            const template = workspace.templates.find(
                              (candidate) =>
                                candidate.versionId ===
                                event.currentTarget.value,
                            );
                            form.setFieldValue(
                              "templateId",
                              event.currentTarget.value,
                            );
                            if (template) {
                              form.setFieldValue("subject", template.subject);
                              form.setFieldValue("textBody", template.textBody);
                            }
                          }}
                          required
                        />
                        <MantineNativeSelect
                          label="Audience"
                          value={values.audience}
                          data={audiences}
                          onChange={(event) => {
                            form.setFieldValue(
                              "audience",
                              event.currentTarget.value,
                            );
                          }}
                          required
                        />
                        <MantineNativeSelect
                          label="Trigger"
                          value={values.trigger}
                          data={triggers}
                          onChange={(event) => {
                            form.setFieldValue(
                              "trigger",
                              event.currentTarget.value,
                            );
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
                            value={values.sessionId}
                            data={[
                              { value: "", label: "No session" },
                              ...workspace.sessions.map((session) => ({
                                value: session.id,
                                label: session.title,
                              })),
                            ]}
                            onChange={(event) => {
                              form.setFieldValue(
                                "sessionId",
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
                  </Stack>
                </Paper>

                <div className={classes.editor}>
                  <Paper
                    withBorder
                    radius="lg"
                    p="md"
                    className={classes.editorPanel}
                  >
                    <Stack gap="md">
                      <Title order={3} size="h4">
                        Content
                      </Title>
                      <MantineTextInput
                        label="Subject"
                        value={values.subject}
                        maxLength={180}
                        onChange={(event) => {
                          form.setFieldValue(
                            "subject",
                            event.currentTarget.value,
                          );
                        }}
                        required
                      />
                      <EmailBodyEditor
                        body={values.textBody}
                        variableGroups={workspace.variableGroups}
                        onChange={(value) => {
                          form.setFieldValue("textBody", value);
                        }}
                      />
                    </Stack>
                  </Paper>
                  {preview ? (
                    <Paper
                      withBorder
                      radius="lg"
                      p="md"
                      className={classes.previewPanel}
                    >
                      <Stack gap="md">
                        <Text fw={700}>{preview.subject}</Text>
                        <Text className={classes.body}>{preview.textBody}</Text>
                      </Stack>
                    </Paper>
                  ) : null}
                </div>
                <Group justify="flex-end">
                  <Button
                    type="button"
                    variant="default"
                    disabled={pending}
                    onClick={() => void loadPreview(values)}
                  >
                    Preview
                  </Button>
                  {occurrence && item?.overrideState === "overridden" ? (
                    <Button
                      type="button"
                      variant="default"
                      disabled={pending}
                      onClick={() => {
                        if (workspace.scope.kind !== "event_occurrence") return;
                        void mutateAdminCommunication({
                          data: {
                            action: "reset_occurrence",
                            payload: {
                              eventOccurrenceId:
                                workspace.scope.eventOccurrenceId,
                              logicalId: item.logicalId,
                            },
                          },
                        }).then((result) =>
                          result.status === "ready" ? onSaved() : undefined,
                        );
                      }}
                    >
                      Reset to inherited email
                    </Button>
                  ) : null}
                  {workspace.scope.editable ? (
                    <Button type="submit" loading={pending}>
                      {occurrence
                        ? "Save occurrence email"
                        : "Save automated email"}
                    </Button>
                  ) : null}
                </Group>
              </Stack>
            </form>
          </Stack>
        );
      }}
    </form.Subscribe>
  );
}
