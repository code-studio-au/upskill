import { useForm } from "@tanstack/react-form";
import { useCallback, useEffect, useState } from "react";
import type {
  AdminCommunicationPlanItem,
  AdminCommunicationWorkspace,
} from "./admin-communication.schema";
import { formatCommunicationTiming } from "./communication-options";
import { EmailBodyEditor } from "./EmailBodyEditor";
import { Badge } from "#/features/shared/Badge";
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

interface OccurrenceDraft {
  offsetAmount: number;
  offsetUnit: "minute" | "hour" | "day" | "week";
  subject: string;
  textBody: string;
}

export function AdminCommunicationPlanEditor({
  scope,
}: {
  scope: { kind: "event_occurrence"; eventOccurrenceId: string };
}) {
  const [workspace, setWorkspace] =
    useState<AdminCommunicationWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminCommunicationPlanItem | null>(
    null,
  );
  const eventOccurrenceId = scope.eventOccurrenceId;
  const requestWorkspace = useCallback(
    () =>
      getAdminCommunicationWorkspace({
        data: { kind: "event_occurrence", eventOccurrenceId },
      }),
    [eventOccurrenceId],
  );
  const load = useCallback(async () => {
    const result = await requestWorkspace();
    if (result.status === "ready") setWorkspace(result.data);
    else setError("The communication plan could not be loaded.");
  }, [requestWorkspace]);

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
  if (editing)
    return (
      <OccurrenceCommunicationForm
        eventOccurrenceId={eventOccurrenceId}
        workspace={workspace}
        item={editing}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
    );

  return (
    <Stack gap="lg">
      <Title order={2}>Communications</Title>
      {error ? <Alert color="red">{error}</Alert> : null}
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
                      : "Inherited"}
                  </Badge>
                </Group>
                <Text size="sm" c="dimmed">
                  {formatCommunicationTiming(
                    item.trigger,
                    item.offsetAmount,
                    item.offsetUnit,
                  )}
                  {section ? ` · ${section.title}` : ""}
                </Text>
                <Button
                  variant={workspace.scope.editable ? "light" : "default"}
                  onClick={() => {
                    setEditing(item);
                  }}
                >
                  {workspace.scope.editable ? "Customise" : "Preview"}
                </Button>
              </Paper>
            );
          })}
        </div>
      )}
    </Stack>
  );
}

function OccurrenceCommunicationForm({
  eventOccurrenceId,
  workspace,
  item,
  onClose,
  onSaved,
}: {
  eventOccurrenceId: string;
  workspace: AdminCommunicationWorkspace;
  item: AdminCommunicationPlanItem;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    subject: string;
    textBody: string;
  } | null>(null);
  const form = useForm({
    defaultValues: {
      offsetAmount: item.offsetAmount,
      offsetUnit: item.offsetUnit,
      subject: item.subject,
      textBody: item.textBody,
    } satisfies OccurrenceDraft,
    onSubmit: async ({ value }) => {
      setError(null);
      const result = await mutateAdminCommunication({
        data: {
          action: "override_occurrence",
          payload: {
            eventOccurrenceId,
            logicalId: item.logicalId,
            subject: value.subject,
            textBody: value.textBody,
            offsetAmount: value.offsetAmount,
            offsetUnit: value.offsetUnit,
          },
        },
      });
      if (result.status === "ready") await onSaved();
      else setError("The occurrence override could not be saved.");
    },
  });

  async function loadPreview(values: OccurrenceDraft) {
    if (!values.subject.trim() || !values.textBody.trim()) {
      setError("Enter a subject and email body before previewing.");
      return;
    }
    setError(null);
    const result = await previewAdminCommunication({
      data: {
        scope: { kind: "event_occurrence", eventOccurrenceId },
        communicationId: item.id,
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
      {({ pending, values }) => (
        <Stack gap="lg">
          <Group justify="space-between" align="center">
            <Title order={2}>
              {workspace.scope.editable
                ? "Customise occurrence email"
                : "Preview automated email"}
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
                  <div className={classes.timingGrid}>
                    <MantineTextInput
                      type="number"
                      label="Timing offset"
                      value={String(values.offsetAmount)}
                      disabled={!workspace.scope.editable}
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
                      disabled={!workspace.scope.editable}
                      data={[
                        { value: "minute", label: "Minutes" },
                        { value: "hour", label: "Hours" },
                        { value: "day", label: "Days" },
                        { value: "week", label: "Weeks" },
                      ]}
                      onChange={(event) => {
                        form.setFieldValue(
                          "offsetUnit",
                          event.currentTarget
                            .value as OccurrenceDraft["offsetUnit"],
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
                      disabled={!workspace.scope.editable}
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
                        if (workspace.scope.editable)
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
                {workspace.scope.editable &&
                item.overrideState === "overridden" ? (
                  <Button
                    type="button"
                    variant="default"
                    disabled={pending}
                    onClick={() => {
                      void mutateAdminCommunication({
                        data: {
                          action: "reset_occurrence",
                          payload: {
                            eventOccurrenceId,
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
                    Save occurrence email
                  </Button>
                ) : null}
              </Group>
            </Stack>
          </form>
        </Stack>
      )}
    </form.Subscribe>
  );
}
