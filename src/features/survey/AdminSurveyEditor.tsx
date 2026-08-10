import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Title,
} from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { SurveySectionsEditor } from "./SurveySectionsEditor";
import {
  adminSurveyDraftSchema,
  type AdminSurveyDetail,
  type AdminSurveyDraft,
} from "./survey.schema";
import {
  createAdminSurveyVersion,
  publishAdminSurvey,
  saveAdminSurvey,
} from "#/server/functions/admin-survey";

export function AdminSurveyEditor({
  detail,
  onChanged,
}: {
  detail: AdminSurveyDetail;
  onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<AdminSurveyDraft>(() => detail.draft);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = detail.version.editable;

  async function persist(): Promise<boolean> {
    const parsed = adminSurveyDraftSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Review the survey.");
      return false;
    }
    setPending("save");
    setMessage(null);
    setError(null);
    try {
      const result = await saveAdminSurvey({ data: parsed.data });
      if (result.status !== "ready") {
        setError("The survey draft could not be saved.");
        return false;
      }
      setMessage("Draft saved.");
      return true;
    } finally {
      setPending(null);
    }
  }

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Button component={Link} to="/admin/surveys" variant="subtle" px={0}>
            Back to surveys
          </Button>
          <Group gap="sm" mt="xs">
            <Title order={1}>{detail.survey.title}</Title>
            <Badge variant="light">Version {detail.version.version}</Badge>
            <Badge color={editable ? "blue" : "green"} variant="light">
              {editable ? "Draft" : "Published"}
            </Badge>
          </Group>
        </div>
        <Group>
          {editable ? (
            <>
              <Button
                variant="default"
                loading={pending === "save"}
                onClick={() => void persist()}
              >
                Save draft
              </Button>
              <Button
                loading={pending === "publish"}
                onClick={() => {
                  setPending("publish");
                  void persist()
                    .then(async (saved) => {
                      if (!saved) return;
                      const result = await publishAdminSurvey({
                        data: {
                          surveyId: detail.survey.id,
                          versionId: detail.version.id,
                        },
                      });
                      if (result.status !== "ready") {
                        setError(
                          "Add at least one valid survey item before publishing.",
                        );
                        return;
                      }
                      await onChanged();
                    })
                    .finally(() => {
                      setPending(null);
                    });
                }}
              >
                Publish version
              </Button>
            </>
          ) : (
            <Button
              loading={pending === "new-version"}
              onClick={() => {
                setPending("new-version");
                setError(null);
                void createAdminSurveyVersion({
                  data: { surveyId: detail.survey.id },
                })
                  .then(async (result) => {
                    if (result.status !== "ready") {
                      setError("A draft survey version already exists.");
                      return;
                    }
                    await onChanged();
                  })
                  .finally(() => {
                    setPending(null);
                  });
              }}
            >
              Create version {detail.version.version + 1}
            </Button>
          )}
        </Group>
      </Group>

      {!editable ? (
        <Alert color="indigo" title="Published versions are immutable">
          Create a new version to change sections or items. Existing course
          versions remain pinned to this survey version.
        </Alert>
      ) : null}
      {message ? <Alert color="green">{message}</Alert> : null}
      {error ? <Alert color="red">{error}</Alert> : null}

      <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
        <Stack gap="md">
          <Title order={2}>Survey details</Title>
          <MantineTextInput
            label="Title"
            value={draft.title}
            disabled={!editable}
            onChange={(event) => {
              const title = event.currentTarget.value;
              setDraft((current) => ({ ...current, title }));
            }}
            required
          />
          <MantineTextInput
            component="textarea"
            label="Introduction"
            value={draft.description}
            disabled={!editable}
            onChange={(event) => {
              const description = event.currentTarget.value;
              setDraft((current) => ({ ...current, description }));
            }}
          />
        </Stack>
      </Paper>

      <SurveySectionsEditor
        editable={editable}
        sections={draft.sections}
        onChange={(sections) => {
          setDraft((current) => ({ ...current, sections }));
        }}
      />
    </Stack>
  );
}
