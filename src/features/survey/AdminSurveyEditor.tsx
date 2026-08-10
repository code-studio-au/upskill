import { Badge } from "#/features/shared/Badge";
import { Alert, Button, Group, Paper, Stack, Title } from "@mantine/core";
import { useForm, useStore } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { firstFormError } from "#/features/shared/form-errors";
import { SurveySectionsEditor } from "./SurveySectionsEditor";
import {
  adminSurveyDraftSchema,
  type AdminSurveyDetail,
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
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitIntent = useRef<"save" | "publish">("save");
  const editable = detail.version.editable;
  const surveyForm = useForm({
    defaultValues: detail.draft,
    validators: { onSubmit: adminSurveyDraftSchema },
    onSubmit: async ({ value }) => {
      const parsed = adminSurveyDraftSchema.safeParse(value);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Review the survey.");
        return;
      }
      setMessage(null);
      setError(null);
      const result = await saveAdminSurvey({ data: parsed.data });
      if (result.status !== "ready") {
        setError("The survey draft could not be saved.");
        return;
      }
      if (submitIntent.current === "save") {
        setMessage("Draft saved.");
        return;
      }
      const published = await publishAdminSurvey({
        data: {
          surveyId: detail.survey.id,
          versionId: detail.version.id,
        },
      });
      if (published.status !== "ready") {
        setError("Add at least one valid survey item before publishing.");
        return;
      }
      await onChanged();
    },
  });
  const sections = useStore(surveyForm.store, (state) => state.values.sections);

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
            <surveyForm.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <>
                  <Button
                    variant="default"
                    loading={isSubmitting && submitIntent.current === "save"}
                    disabled={isSubmitting}
                    onClick={() => {
                      submitIntent.current = "save";
                      void surveyForm.handleSubmit();
                    }}
                  >
                    Save draft
                  </Button>
                  <Button
                    loading={isSubmitting && submitIntent.current === "publish"}
                    disabled={isSubmitting}
                    onClick={() => {
                      submitIntent.current = "publish";
                      void surveyForm.handleSubmit();
                    }}
                  >
                    Publish version
                  </Button>
                </>
              )}
            </surveyForm.Subscribe>
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
      <surveyForm.Subscribe selector={(state) => state.errors}>
        {(errors) => {
          const validationError = firstFormError(errors);
          return validationError ? (
            <Alert color="red">{validationError}</Alert>
          ) : null;
        }}
      </surveyForm.Subscribe>

      <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
        <Stack gap="md">
          <Title order={2}>Survey details</Title>
          <surveyForm.Field name="title">
            {(field) => (
              <MantineTextInput
                label="Title"
                name={field.name}
                value={field.state.value}
                disabled={!editable}
                error={firstFormError(field.state.meta.errors)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.currentTarget.value);
                }}
                required
              />
            )}
          </surveyForm.Field>
          <surveyForm.Field name="description">
            {(field) => (
              <MantineTextInput
                component="textarea"
                label="Introduction"
                name={field.name}
                value={field.state.value}
                disabled={!editable}
                error={firstFormError(field.state.meta.errors)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.currentTarget.value);
                }}
              />
            )}
          </surveyForm.Field>
        </Stack>
      </Paper>

      <SurveySectionsEditor
        editable={editable}
        sections={sections}
        onChange={(sections) => {
          surveyForm.setFieldValue("sections", sections);
        }}
      />
    </Stack>
  );
}
