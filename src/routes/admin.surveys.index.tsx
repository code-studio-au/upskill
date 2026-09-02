import { Badge } from "#/features/shared/Badge";
import {
  Alert,
  Button,
  Group,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
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
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { PageTabs } from "#/features/shared/PageTabs";
import { OrderedCatalogue } from "#/features/shared/OrderedCatalogue";
import {
  adminSurveyCreateSchema,
  type AdminSurveySummary,
} from "#/features/survey/survey.schema";
import {
  createAdminSurvey,
  getAdminSurveys,
  moveAdminSurvey,
} from "#/server/functions/admin-survey";
import classes from "./admin.surveys.module.css";

interface SurveyCreateValues {
  title: string;
  type: "system" | "registration" | "elearning" | "event" | "shared";
}

const defaultSurveyCreateValues: SurveyCreateValues = {
  title: "",
  type: "elearning",
};

type SurveyType = SurveyCreateValues["type"];

function SurveyCatalogue({ surveys }: { surveys: Array<AdminSurveySummary> }) {
  return (
    <OrderedCatalogue
      empty="No surveys have been created in this section."
      onMove={(id, direction) => {
        void move(id, direction);
      }}
      items={surveys.map((survey) => ({
        id: survey.id,
        label: survey.title,
        title: (
          <Link
            className={classes.cardTitleLink}
            to="/admin/surveys/$surveyId"
            params={{ surveyId: survey.id }}
          >
            <Title order={2} size="h3">
              {survey.title}
            </Title>
          </Link>
        ),
        status: (
          <Group gap="xs" wrap="wrap" justify="flex-end">
            {survey.publishedVersion ? (
              <Badge color="green">Published v{survey.publishedVersion}</Badge>
            ) : (
              <Badge color="gray">Not published</Badge>
            )}
            {survey.draftVersion ? (
              <Badge color="gray">Draft v{survey.draftVersion}</Badge>
            ) : null}
          </Group>
        ),
      }))}
    />
  );
}

async function move(surveyId: string, direction: "down" | "up") {
  const result = await moveAdminSurvey({
    data: { surveyId, direction },
  }).catch(() => null);
  if (result) window.location.reload();
}

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
  const [type, setType] = useState<SurveyType>("system");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createValues, setCreateValues] = useState(defaultSurveyCreateValues);
  const create = async () => {
    setError(null);
    const parsed = adminSurveyCreateSchema.safeParse(createValues);
    if (!parsed.success) {
      setError("Enter a survey title of at least two characters.");
      return;
    }
    setCreating(true);
    try {
      const created = await createAdminSurvey({ data: parsed.data });
      if (created.status !== "ready") {
        setError("The survey could not be created.");
        return;
      }
      await router.navigate({
        to: "/admin/surveys/$surveyId",
        params: { surveyId: created.data.surveyId },
      });
    } catch {
      setError("The survey could not be created.");
    } finally {
      setCreating(false);
    }
  };
  if (result.status === "forbidden") return <AdminAccessDenied />;

  const systemSurveys = result.data.filter(
    (survey) => survey.type === "system",
  );
  const elearningSurveys = result.data.filter(
    (survey) => survey.type === "elearning",
  );
  const eventSurveys = result.data.filter((survey) => survey.type === "event");
  const registrationSurveys = result.data.filter(
    (survey) => survey.type === "registration",
  );
  const sharedSurveys = result.data.filter(
    (survey) => survey.type === "shared",
  );
  const visibleSurveys =
    type === "system"
      ? systemSurveys
      : type === "registration"
        ? registrationSurveys
        : type === "elearning"
          ? elearningSurveys
          : type === "event"
            ? eventSurveys
            : sharedSurveys;

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Text c="indigo.7" fw={700}>
            Learning content
          </Text>
          <Title order={1}>Surveys</Title>
        </div>
        <Button
          onClick={() => {
            setCreateValues(defaultSurveyCreateValues);
            setError(null);
            setOpened(true);
          }}
        >
          Create survey
        </Button>
      </Group>

      <PageTabs
        label="Survey catalogue"
        value={type}
        tabs={[
          {
            value: "system",
            label: `System (${String(systemSurveys.length)})`,
          },
          {
            value: "registration",
            label: `Registration (${String(registrationSurveys.length)})`,
          },
          {
            value: "elearning",
            label: `eLearning (${String(elearningSurveys.length)})`,
          },
          {
            value: "event",
            label: `Event (${String(eventSurveys.length)})`,
          },
          {
            value: "shared",
            label: `Shared (${String(sharedSurveys.length)})`,
          },
        ]}
        onChange={setType}
      />
      <SurveyCatalogue surveys={visibleSurveys} />

      {opened ? (
        <AppDialog
          title="Create survey"
          closeDisabled={creating}
          onClose={() => {
            if (!creating) setOpened(false);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <Stack gap="md">
              <MantineTextInput
                label="Survey title"
                value={createValues.title}
                onChange={(event) => {
                  const nextTitle = event.currentTarget.value;
                  setCreateValues((current) => ({
                    ...current,
                    title: nextTitle,
                  }));
                }}
                required
              />
              <MantineNativeSelect
                label="Survey type"
                value={createValues.type}
                data={[
                  { value: "system", label: "System onboarding" },
                  { value: "registration", label: "Registration" },
                  { value: "elearning", label: "eLearning" },
                  { value: "event", label: "Event" },
                  { value: "shared", label: "Shared" },
                ]}
                onChange={(event) => {
                  const nextType = event.currentTarget.value;
                  setCreateValues((current) => ({
                    ...current,
                    type:
                      nextType === "system" ||
                      nextType === "registration" ||
                      nextType === "event" ||
                      nextType === "shared"
                        ? nextType
                        : "elearning",
                  }));
                }}
                required
              />
              {error ? <Alert color="red">{error}</Alert> : null}
              <Group justify="flex-end">
                <Button
                  type="button"
                  variant="default"
                  disabled={creating}
                  onClick={() => {
                    setOpened(false);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={creating}>
                  Create draft
                </Button>
              </Group>
            </Stack>
          </form>
        </AppDialog>
      ) : null}
    </Stack>
  );
}
