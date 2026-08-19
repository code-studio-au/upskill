import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type {
  AdminEmailDesignDetail,
  AdminEmailPreview,
} from "./admin-email.schema";
import { adminEmailDesignDraftSchema } from "./admin-email.schema";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { firstFormError } from "#/features/shared/form-errors";
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
  createAdminEmailDraft,
  deleteAdminEmailDraft,
  previewAdminEmail,
  publishAdminEmail,
  rollbackAdminEmail,
  saveAdminEmailDraft,
} from "#/server/functions/admin-email";
import classes from "./AdminEmailDesigner.module.css";

interface Props {
  detail: AdminEmailDesignDetail;
}

function variableSelectData(variables: AdminEmailDesignDetail["variables"]) {
  const groups = new Map<string, Array<{ label: string; value: string }>>();
  for (const variable of variables) {
    const items = groups.get(variable.category) ?? [];
    items.push({
      value: variable.key,
      label: `${variable.label}${variable.required ? " *" : ""}`,
    });
    groups.set(variable.category, items);
  }
  return [
    { value: "", label: "Select a variable" },
    ...Array.from(groups, ([group, items]) => ({ group, items })),
  ];
}

export function AdminEmailDesignEditor({ detail }: Props) {
  const router = useRouter();
  const bodyInputRef = useRef<HTMLTextAreaElement | null>(null);
  const bodySelectionRef = useRef({
    start: detail.version.textBody.length,
    end: detail.version.textBody.length,
  });
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [preview, setPreview] = useState<AdminEmailPreview | null>(null);
  const [selectedVariable, setSelectedVariable] = useState("");
  const [confirmation, setConfirmation] = useState<
    "activate" | "delete" | "publish" | null
  >(null);
  const form = useForm({
    defaultValues: {
      emailDesignId: detail.design.id,
      versionId: detail.version.id,
      subject: detail.version.subject,
      textBody: detail.version.textBody,
    },
    validators: { onSubmit: adminEmailDesignDraftSchema },
    onSubmit: async ({ value }) => {
      setWorking("save");
      setError(null);
      try {
        const result = await saveAdminEmailDraft({ data: value });
        if (result.status !== "ready") {
          setError("The draft could not be saved. Check its variables.");
          return;
        }
        await router.invalidate();
      } finally {
        setWorking(null);
      }
    },
  });

  async function loadPreview() {
    const values = form.state.values;
    const parsed = adminEmailDesignDraftSchema.safeParse(values);
    if (!parsed.success) {
      setError("Enter a valid subject and email body.");
      return;
    }
    setWorking("preview");
    setError(null);
    try {
      const result = await previewAdminEmail({ data: parsed.data });
      if (result.status !== "ready") {
        setError("The preview could not be rendered. Check its variables.");
        return;
      }
      setPreview(result.data);
    } finally {
      setWorking(null);
    }
  }

  async function publishDraft() {
    const values = form.state.values;
    const parsed = adminEmailDesignDraftSchema.safeParse(values);
    if (!parsed.success) {
      setError("Enter a valid subject and email body.");
      return;
    }
    setWorking("publish");
    setError(null);
    try {
      const saved = await saveAdminEmailDraft({ data: parsed.data });
      if (saved.status !== "ready") {
        setError("The draft could not be published. Check its variables.");
        return;
      }
      const published = await publishAdminEmail({
        data: {
          emailDesignId: detail.design.id,
          versionId: detail.version.id,
        },
      });
      if (published.status !== "ready") {
        setError("The draft could not be published.");
        return;
      }
      await router.navigate({
        to: "/admin/emails/$emailDesignId",
        params: { emailDesignId: detail.design.id },
        search: { versionId: detail.version.id },
      });
      await router.invalidate();
    } finally {
      setWorking(null);
    }
  }

  async function createDraft() {
    setWorking("draft");
    setError(null);
    try {
      const result = await createAdminEmailDraft({
        data: { emailDesignId: detail.design.id },
      });
      if (result.status !== "ready" || !result.data.versionId) {
        setError("A new draft could not be created.");
        return;
      }
      await router.navigate({
        to: "/admin/emails/$emailDesignId",
        params: { emailDesignId: detail.design.id },
        search: { versionId: result.data.versionId },
      });
      await router.invalidate();
    } finally {
      setWorking(null);
    }
  }

  async function rollbackVersion() {
    setWorking("rollback");
    setError(null);
    try {
      const result = await rollbackAdminEmail({
        data: {
          emailDesignId: detail.design.id,
          versionId: detail.version.id,
        },
      });
      if (result.status !== "ready") {
        setError("This version could not be activated.");
        return;
      }
      await router.invalidate();
    } finally {
      setWorking(null);
    }
  }

  async function deleteDraft() {
    setWorking("delete");
    setError(null);
    try {
      const result = await deleteAdminEmailDraft({
        data: {
          emailDesignId: detail.design.id,
          versionId: detail.version.id,
        },
      });
      if (result.status !== "ready") {
        setError("The draft could not be deleted.");
        return;
      }
      const active = detail.versions.find((version) => version.active);
      if (!active) {
        await router.navigate({ to: "/admin/emails" });
        return;
      }
      await router.navigate({
        to: "/admin/emails/$emailDesignId",
        params: { emailDesignId: detail.design.id },
        search: { versionId: active.id },
      });
      await router.invalidate();
    } finally {
      setWorking(null);
    }
  }

  const draftExists = detail.versions.some(
    (version) => version.publishedAt === null,
  );
  const confirmationContent =
    confirmation === "publish"
      ? {
          title: `Publish version ${String(detail.version.version)}?`,
          body: "New notifications use this version. Queued notifications do not change.",
          action: "Publish version",
        }
      : confirmation === "activate"
        ? {
            title: `Activate version ${String(detail.version.version)}?`,
            body: "New notifications use this version. Existing deliveries do not change.",
            action: "Activate version",
          }
        : confirmation === "delete"
          ? {
              title: `Delete draft version ${String(detail.version.version)}?`,
              body: "This unpublished draft will be removed.",
              action: "Delete draft",
            }
          : null;
  return (
    <Stack gap="lg">
      <div className={classes.editorHeader}>
        <div>
          <Title order={1}>{detail.design.name}</Title>
        </div>
      </div>

      <Paper withBorder radius="lg" p="md">
        <div className={classes.versionBar}>
          <MantineNativeSelect
            label="Version"
            value={detail.version.id}
            data={detail.versions.map((version) => ({
              value: version.id,
              label: version.publishedAt
                ? `Published v${String(version.version)}${version.active ? " · Active" : ""}`
                : `Draft v${String(version.version)}`,
            }))}
            onChange={(event) => {
              void router.navigate({
                to: "/admin/emails/$emailDesignId",
                params: { emailDesignId: detail.design.id },
                search: { versionId: event.currentTarget.value },
              });
            }}
          />
          <Group gap="sm" className={classes.editorActions}>
            <Button
              variant="default"
              loading={working === "preview"}
              disabled={working !== null}
              onClick={() => void loadPreview()}
            >
              Preview
            </Button>
            {detail.version.editable ? (
              <>
                <Button
                  color="red"
                  variant="light"
                  disabled={working !== null}
                  onClick={() => {
                    setConfirmation("delete");
                  }}
                >
                  Delete draft
                </Button>
                <Button
                  disabled={working !== null}
                  onClick={() => {
                    setConfirmation("publish");
                  }}
                >
                  Publish
                </Button>
              </>
            ) : (
              <>
                {!draftExists ? (
                  <Button
                    loading={working === "draft"}
                    disabled={working !== null}
                    onClick={() => void createDraft()}
                  >
                    Create new version
                  </Button>
                ) : null}
                {!detail.version.active ? (
                  <Button
                    variant="light"
                    disabled={working !== null}
                    onClick={() => {
                      setConfirmation("activate");
                    }}
                  >
                    Activate this version
                  </Button>
                ) : null}
              </>
            )}
          </Group>
        </div>
      </Paper>

      {error ? <Alert color="red">{error}</Alert> : null}

      <div className={classes.editor}>
        <Paper withBorder radius="lg" p="md" className={classes.editorPanel}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <Stack gap="md">
              <Title order={2} size="h3">
                Content
              </Title>
              <form.Field name="subject">
                {(field) => (
                  <MantineTextInput
                    label="Subject"
                    value={field.state.value}
                    error={firstFormError(field.state.meta.errors)}
                    disabled={!detail.version.editable}
                    maxLength={180}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    required
                  />
                )}
              </form.Field>
              <form.Field name="textBody">
                {(field) => (
                  <MantineTextInput
                    component="textarea"
                    label="Email body"
                    inputRef={bodyInputRef}
                    value={field.state.value}
                    error={firstFormError(field.state.meta.errors)}
                    disabled={!detail.version.editable}
                    maxLength={20_000}
                    classNames={{ input: classes.bodyInput }}
                    onBlur={(event) => {
                      bodySelectionRef.current = {
                        start:
                          event.currentTarget.selectionStart ??
                          event.currentTarget.value.length,
                        end:
                          event.currentTarget.selectionEnd ??
                          event.currentTarget.value.length,
                      };
                      field.handleBlur();
                    }}
                    onChange={(event) => {
                      bodySelectionRef.current = {
                        start:
                          event.currentTarget.selectionStart ??
                          event.currentTarget.value.length,
                        end:
                          event.currentTarget.selectionEnd ??
                          event.currentTarget.value.length,
                      };
                      field.handleChange(event.currentTarget.value);
                    }}
                    required
                  />
                )}
              </form.Field>
              <div className={classes.variablePicker}>
                <MantineNativeSelect
                  label="Available variables"
                  value={selectedVariable}
                  disabled={!detail.version.editable}
                  data={variableSelectData(detail.variables)}
                  onChange={(event) => {
                    setSelectedVariable(event.currentTarget.value);
                  }}
                />
                <Button
                  type="button"
                  variant="light"
                  disabled={!detail.version.editable || !selectedVariable}
                  onClick={() => {
                    const variable = detail.variables.find(
                      (candidate) => candidate.key === selectedVariable,
                    );
                    if (!variable) return;
                    const current = form.getFieldValue("textBody");
                    const start = Math.min(
                      bodySelectionRef.current.start,
                      current.length,
                    );
                    const end = Math.min(
                      Math.max(bodySelectionRef.current.end, start),
                      current.length,
                    );
                    const token = `{{${variable.key}}}`;
                    form.setFieldValue(
                      "textBody",
                      [current.slice(0, start), token, current.slice(end)].join(
                        "",
                      ),
                    );
                    const nextCaret = start + token.length;
                    bodySelectionRef.current = {
                      start: nextCaret,
                      end: nextCaret,
                    };
                    requestAnimationFrame(() => {
                      bodyInputRef.current?.focus();
                      bodyInputRef.current?.setSelectionRange(
                        nextCaret,
                        nextCaret,
                      );
                    });
                  }}
                >
                  Add variable
                </Button>
              </div>
              {detail.version.editable ? (
                <Group justify="flex-end">
                  <Button
                    type="submit"
                    loading={working === "save"}
                    disabled={working !== null}
                  >
                    Save draft
                  </Button>
                </Group>
              ) : null}
            </Stack>
          </form>
        </Paper>

        {preview ? (
          <Paper withBorder radius="lg" p="md" className={classes.previewPanel}>
            <Stack gap="md">
              <Text fw={700}>{preview.subject}</Text>
              <Text className={classes.previewBody}>{preview.textBody}</Text>
            </Stack>
          </Paper>
        ) : null}
      </div>

      {confirmationContent ? (
        <ConfirmationDialog
          title={confirmationContent.title}
          description={confirmationContent.body}
          confirmLabel={confirmationContent.action}
          confirmColor={confirmation === "delete" ? "red" : "indigo"}
          pending={working !== null}
          onCancel={() => {
            setConfirmation(null);
          }}
          onConfirm={() => {
            const action = confirmation;
            const run =
              action === "publish"
                ? publishDraft
                : action === "activate"
                  ? rollbackVersion
                  : deleteDraft;
            void run().then(() => {
              setConfirmation(null);
            });
          }}
        />
      ) : null}
    </Stack>
  );
}
