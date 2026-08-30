import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import type {
  AdminCommunicationTemplateOption,
  CommunicationScope,
  CourseScheduleEmailItem,
  EventScheduleEmailItem,
} from "./admin-communication.schema";
import type { EmailTemplateVariableGroup } from "./admin-email.schema";
import {
  courseCommunicationAudiences,
  courseCommunicationTriggers,
  eventCommunicationAudiencesForTrigger,
  eventCommunicationTriggers,
} from "./communication-options";
import { EmailBodyEditor } from "./EmailBodyEditor";
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
import { previewAdminCommunication } from "#/server/functions/admin-communication";
import classes from "./AdminCommunicationPlanEditor.module.css";

type ScheduleEmailItem = CourseScheduleEmailItem | EventScheduleEmailItem;

interface FormValues {
  title: string;
  templateId: string;
  audience: ScheduleEmailItem["audience"];
  trigger: ScheduleEmailItem["trigger"];
  sessionItemId: string;
  offsetAmount: number;
  offsetUnit: "minute" | "hour" | "day" | "week";
  subject: string;
  textBody: string;
}

export function ScheduleEmailEditor({
  scope,
  item,
  templates,
  variableGroups,
  sessions,
  offeringTitle,
  sectionTitle,
  editable,
  onChange,
  onClose,
}: {
  scope: Extract<CommunicationScope, { kind: "course" | "event_template" }>;
  item: ScheduleEmailItem;
  templates: Array<AdminCommunicationTemplateOption>;
  variableGroups: Array<EmailTemplateVariableGroup>;
  sessions: Array<{ id: string; title: string }>;
  offeringTitle: string;
  sectionTitle: string;
  editable: boolean;
  onChange: (item: ScheduleEmailItem) => void;
  onClose: () => void;
}) {
  const selected = templates.find(
    (template) => template.versionId === item.emailDesignVersionId,
  );
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    subject: string;
    textBody: string;
  } | null>(null);
  const form = useForm({
    defaultValues: {
      title: item.title,
      templateId: item.emailDesignVersionId,
      audience: item.audience,
      trigger: item.trigger,
      sessionItemId: "sessionItemId" in item ? (item.sessionItemId ?? "") : "",
      offsetAmount: item.offsetAmount,
      offsetUnit: item.offsetUnit,
      subject: item.subjectOverride ?? selected?.subject ?? "",
      textBody: item.textBodyOverride ?? selected?.textBody ?? "",
    },
    onSubmit: ({ value }) => {
      const template = templates.find(
        (candidate) => candidate.versionId === value.templateId,
      );
      if (!template) {
        setError("Select a published email template.");
        return;
      }
      if (
        scope.kind === "event_template" &&
        value.trigger === "session_start" &&
        !value.sessionItemId
      ) {
        setError("Select the session that anchors this email.");
        return;
      }
      const common = {
        id: item.id,
        kind: "automated_email" as const,
        title: value.title,
        emailDesignVersionId: value.templateId,
        offsetAmount: value.offsetAmount,
        offsetUnit: value.offsetUnit,
        subjectOverride:
          value.subject === template.subject ? null : value.subject,
        textBodyOverride:
          value.textBody === template.textBody ? null : value.textBody,
      };
      onChange(
        scope.kind === "course"
          ? {
              ...common,
              audience: value.audience as CourseScheduleEmailItem["audience"],
              trigger: value.trigger as CourseScheduleEmailItem["trigger"],
            }
          : {
              ...common,
              audience: value.audience as EventScheduleEmailItem["audience"],
              trigger: value.trigger as EventScheduleEmailItem["trigger"],
              sessionItemId: value.sessionItemId || null,
            },
      );
      onClose();
    },
  });
  const audiencesFor = (trigger: string) =>
    scope.kind === "course"
      ? courseCommunicationAudiences
      : eventCommunicationAudiencesForTrigger(trigger);
  const triggers =
    scope.kind === "course"
      ? courseCommunicationTriggers
      : eventCommunicationTriggers;

  async function loadPreview(values: FormValues) {
    if (!values.subject.trim() || !values.textBody.trim()) {
      setError("Enter a subject and email body before previewing.");
      return;
    }
    const result = await previewAdminCommunication({
      data: {
        scope,
        emailDesignVersionId: values.templateId,
        subject: values.subject,
        textBody: values.textBody,
        offeringTitle,
        sectionTitle,
        ...(values.sessionItemId
          ? {
              sessionTitle: sessions.find(
                (session) => session.id === values.sessionItemId,
              )?.title,
            }
          : {}),
      },
    });
    if (result.status === "ready") {
      setError(null);
      setPreview(result.data);
    } else setError("The email preview could not be generated.");
  }

  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <Stack gap="lg">
          <Group justify="space-between">
            <Title order={2}>Automated email</Title>
            <Button variant="default" onClick={onClose}>
              Back to schedule
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
                  <MantineTextInput
                    label="Schedule label"
                    value={values.title}
                    disabled={!editable}
                    onChange={(event) => {
                      form.setFieldValue("title", event.currentTarget.value);
                    }}
                    required
                  />
                  <MantineNativeSelect
                    label="Email template"
                    value={values.templateId}
                    disabled={!editable}
                    data={templates.flatMap((template) =>
                      template.selectable !== false ||
                      template.versionId === values.templateId
                        ? [
                            {
                              value: template.versionId,
                              label: `${template.designName} · v${String(template.version)}`,
                            },
                          ]
                        : [],
                    )}
                    onChange={(event) => {
                      const template = templates.find(
                        (candidate) =>
                          candidate.versionId === event.currentTarget.value,
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
                    disabled={!editable}
                    data={audiencesFor(values.trigger)}
                    onChange={(event) => {
                      form.setFieldValue(
                        "audience",
                        event.currentTarget
                          .value as ScheduleEmailItem["audience"],
                      );
                    }}
                    required
                  />
                  <MantineNativeSelect
                    label="Trigger"
                    value={values.trigger}
                    disabled={!editable}
                    data={triggers}
                    onChange={(event) => {
                      const trigger = event.currentTarget
                        .value as ScheduleEmailItem["trigger"];
                      form.setFieldValue("trigger", trigger);
                      if (
                        scope.kind === "event_template" &&
                        !eventCommunicationAudiencesForTrigger(trigger).some(
                          (audience) => audience.value === values.audience,
                        )
                      )
                        form.setFieldValue("audience", "affected_learner");
                    }}
                    required
                  />
                  {scope.kind === "event_template" && sessions.length ? (
                    <MantineNativeSelect
                      label="Session"
                      value={values.sessionItemId}
                      disabled={!editable}
                      data={[
                        { value: "", label: "No session" },
                        ...sessions.map((session) => ({
                          value: session.id,
                          label: session.title,
                        })),
                      ]}
                      onChange={(event) => {
                        form.setFieldValue(
                          "sessionItemId",
                          event.currentTarget.value,
                        );
                      }}
                    />
                  ) : null}
                  <div className={classes.timingGrid}>
                    <MantineTextInput
                      type="number"
                      label="Timing offset"
                      value={String(values.offsetAmount)}
                      disabled={!editable}
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
                      disabled={!editable}
                      data={[
                        { value: "minute", label: "Minutes" },
                        { value: "hour", label: "Hours" },
                        { value: "day", label: "Days" },
                        { value: "week", label: "Weeks" },
                      ]}
                      onChange={(event) => {
                        form.setFieldValue(
                          "offsetUnit",
                          event.currentTarget.value as FormValues["offsetUnit"],
                        );
                      }}
                      required
                    />
                  </div>
                </Stack>
              </Paper>
              <div className={classes.editor}>
                <Paper withBorder radius="lg" p="md">
                  <Stack gap="md">
                    <Title order={3} size="h4">
                      Content
                    </Title>
                    <MantineTextInput
                      label="Subject"
                      value={values.subject}
                      disabled={!editable}
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
                      variableGroups={variableGroups}
                      onChange={(textBody) => {
                        if (editable) form.setFieldValue("textBody", textBody);
                      }}
                    />
                  </Stack>
                </Paper>
                {preview ? (
                  <Paper withBorder radius="lg" p="md">
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
                  onClick={() => void loadPreview(values)}
                >
                  Preview
                </Button>
                {editable ? <Button type="submit">Apply email</Button> : null}
              </Group>
            </Stack>
          </form>
        </Stack>
      )}
    </form.Subscribe>
  );
}
