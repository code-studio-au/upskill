import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { AppDialog } from "#/features/shared/AppDialog";
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
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
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
            <Card key={survey.id} withBorder radius="lg" padding="lg">
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
            </Card>
          ))}
        </Stack>
      )}

      {opened ? (
        <AppDialog
          title="Create survey"
          closeDisabled={creating}
          onClose={() => {
            setOpened(false);
          }}
        >
          <TextInput
            label="Survey title"
            value={title}
            error={error}
            onChange={(event) => {
              setTitle(event.currentTarget.value);
              setError(undefined);
            }}
            required
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={creating}
              onClick={() => {
                setOpened(false);
              }}
            >
              Cancel
            </Button>
            <Button
              loading={creating}
              onClick={() => {
                const parsed = adminSurveyCreateSchema.safeParse({ title });
                if (!parsed.success) {
                  setError(
                    parsed.error.issues[0]?.message ?? "Enter a survey title.",
                  );
                  return;
                }
                setCreating(true);
                void createAdminSurvey({ data: parsed.data })
                  .then(async (created) => {
                    if (created.status !== "ready") {
                      setError("The survey could not be created.");
                      return;
                    }
                    await router.navigate({
                      to: "/admin/surveys/$surveyId",
                      params: { surveyId: created.data.surveyId },
                    });
                  })
                  .finally(() => {
                    setCreating(false);
                  });
              }}
            >
              Create draft
            </Button>
          </Group>
        </AppDialog>
      ) : null}
    </Stack>
  );
}
