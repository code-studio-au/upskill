import { Badge } from "#/features/shared/Badge";
import { Alert, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { useForm } from "@tanstack/react-form";
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { AppDialog } from "#/features/shared/AppDialog";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { firstFormError } from "#/features/shared/form-errors";
import { adminSurveyCreateSchema } from "#/features/survey/survey.schema";
import {
  createAdminSurvey,
  getAdminSurveys,
} from "#/server/functions/admin-survey";

export const Route = createFileRoute("/admin/surveys/")({
  ssr: false,
  loader: async () => {
    const result = await getAdminSurveys();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/surveys" },
      });
    return result;
  },
  component: AdminSurveysPage,
});

function AdminSurveysPage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const surveyForm = useForm({
    defaultValues: { title: "" },
    validators: { onSubmit: adminSurveyCreateSchema },
    onSubmit: async ({ value }) => {
      const parsed = adminSurveyCreateSchema.safeParse(value);
      if (!parsed.success) return;
      setError(null);
      const created = await createAdminSurvey({ data: parsed.data });
      if (created.status !== "ready") {
        setError("The survey could not be created.");
        return;
      }
      await router.navigate({
        to: "/admin/surveys/$surveyId",
        params: { surveyId: created.data.surveyId },
      });
    },
  });
  if (result.status === "forbidden") return <AdminAccessDenied />;

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Text c="indigo.7" fw={700}>
            Learning content
          </Text>
          <Title order={1}>Surveys</Title>
          <Text c="dimmed" mt="xs">
            Publish immutable question sets for exact course-version references.
          </Text>
        </div>
        <Button
          onClick={() => {
            surveyForm.reset();
            setError(null);
            setOpened(true);
          }}
        >
          Create survey
        </Button>
      </Group>

      {result.data.length === 0 ? (
        <Alert title="No surveys yet">Create the first survey draft.</Alert>
      ) : (
        <Stack gap="md">
          {result.data.map((survey) => (
            <Paper key={survey.id} withBorder radius="lg" p="lg">
              <Group justify="space-between" align="center" wrap="wrap">
                <div>
                  <Group gap="sm">
                    <Title order={2} size="h3">
                      {survey.title}
                    </Title>
                    {survey.draftVersion ? (
                      <Badge>Draft v{survey.draftVersion}</Badge>
                    ) : null}
                  </Group>
                  <Text c="dimmed" size="sm">
                    {survey.publishedVersions} published versions · Latest v
                    {survey.latestVersion}
                  </Text>
                </div>
                <Link
                  to="/admin/surveys/$surveyId"
                  params={{ surveyId: survey.id }}
                >
                  <Button component="span" variant="light">
                    Open survey
                  </Button>
                </Link>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      {opened ? (
        <surveyForm.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <AppDialog
              title="Create survey"
              closeDisabled={isSubmitting}
              onClose={() => {
                if (!isSubmitting) setOpened(false);
              }}
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void surveyForm.handleSubmit();
                }}
              >
                <Stack gap="md">
                  <surveyForm.Field name="title">
                    {(field) => (
                      <MantineTextInput
                        label="Survey title"
                        name={field.name}
                        value={field.state.value}
                        error={firstFormError(field.state.meta.errors)}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.currentTarget.value);
                        }}
                        required
                      />
                    )}
                  </surveyForm.Field>
                  {error ? <Alert color="red">{error}</Alert> : null}
                  <Group justify="flex-end">
                    <Button
                      type="button"
                      variant="default"
                      disabled={isSubmitting}
                      onClick={() => {
                        setOpened(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <surveyForm.Subscribe selector={(state) => state.canSubmit}>
                      {(canSubmit) => (
                        <Button
                          type="submit"
                          loading={isSubmitting}
                          disabled={!canSubmit}
                        >
                          Create draft
                        </Button>
                      )}
                    </surveyForm.Subscribe>
                  </Group>
                </Stack>
              </form>
            </AppDialog>
          )}
        </surveyForm.Subscribe>
      ) : null}
    </Stack>
  );
}
