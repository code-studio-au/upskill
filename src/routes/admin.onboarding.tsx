import { Badge } from "#/features/shared/Badge";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { firstFormError } from "#/features/shared/form-errors";
import {
  activateOnboardingSchema,
  type AdminOnboardingData,
  type OnboardingConfiguration,
} from "#/features/onboarding/onboarding.schema";
import { isOperationalRegionQuestion } from "#/features/survey/survey.schema";
import {
  activateAdminOnboarding,
  getAdminOnboarding,
} from "#/server/functions/onboarding";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";

type ProfileMapping = OnboardingConfiguration["profileMappings"][number];

function withAutomaticCurrentRegionMapping(
  mappings: Array<ProfileMapping>,
  survey: AdminOnboardingData["surveyVersions"][number] | undefined,
): Array<ProfileMapping> {
  const question = survey?.content.sections
    .flatMap((section) => section.items)
    .find(isOperationalRegionQuestion);
  if (!question) return mappings;
  return [
    ...mappings.filter(
      (mapping) =>
        mapping.destination !== "currentRegionId" &&
        mapping.questionId !== question.id,
    ),
    { questionId: question.id, destination: "currentRegionId" },
  ];
}

export const Route = createFileRoute("/admin/onboarding")({
  ssr: false,
  loader: async () => {
    const result = await getAdminOnboarding();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/onboarding" },
      });
    return result;
  },
  component: AdminOnboardingPage,
});

function AdminOnboardingPage() {
  const result = Route.useLoaderData();
  if (result.status === "forbidden") return <AdminAccessDenied />;
  return <AdminOnboardingWorkspace data={result.data} />;
}

function AdminOnboardingWorkspace({ data }: { data: AdminOnboardingData }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const { active, history, surveyVersions } = data;
  const initialSurveyVersionId =
    active?.surveyVersionId ?? surveyVersions[0]?.id ?? "";
  const initialSurvey = surveyVersions.find(
    (survey) => survey.id === initialSurveyVersionId,
  );
  const form = useForm({
    defaultValues: {
      surveyVersionId: initialSurveyVersionId,
      privacyNotice: active?.privacyNotice ?? "",
      privacyNoticeVersion: active?.privacyNoticeVersion ?? "1",
      profileMappings: withAutomaticCurrentRegionMapping(
        active?.profileMappings ?? [],
        initialSurvey,
      ),
    },
    validators: { onSubmit: activateOnboardingSchema },
    onSubmit: async ({ value }) => {
      setError(undefined);
      const response = await activateAdminOnboarding({ data: value });
      if (response.status !== "ready") {
        setError(
          response.status === "invalid"
            ? response.message
            : "Onboarding could not be activated.",
        );
        return;
      }
      await router.invalidate();
    },
  });
  return (
    <Stack gap="lg">
      <Group justify="space-between" align="end" wrap="wrap">
        <Title order={1}>User onboarding</Title>
        {active ? (
          <Badge color="teal">Active version {active.version}</Badge>
        ) : (
          <Badge>No active version</Badge>
        )}
      </Group>
      {surveyVersions.length === 0 ? (
        <Alert title="No onboarding surveys">
          Create and publish a survey with the User onboarding purpose first.
        </Alert>
      ) : (
        <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <Stack gap="md">
              <Title order={2}>Activate a version</Title>
              <form.Field name="surveyVersionId">
                {(field) => (
                  <MantineNativeSelect
                    label="Published onboarding survey"
                    value={field.state.value}
                    error={firstFormError(field.state.meta.errors)}
                    data={surveyVersions.map((survey) => ({
                      value: survey.id,
                      label: `${survey.title} — version ${String(survey.version)}`,
                    }))}
                    onChange={(event) => {
                      const surveyVersionId = event.currentTarget.value;
                      field.handleChange(surveyVersionId);
                      form.setFieldValue(
                        "profileMappings",
                        withAutomaticCurrentRegionMapping(
                          [],
                          surveyVersions.find(
                            (survey) => survey.id === surveyVersionId,
                          ),
                        ),
                      );
                    }}
                    required
                  />
                )}
              </form.Field>
              <form.Field name="privacyNoticeVersion">
                {(field) => (
                  <MantineTextInput
                    label="Privacy notice version"
                    value={field.state.value}
                    error={firstFormError(field.state.meta.errors)}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    required
                  />
                )}
              </form.Field>
              <form.Field name="privacyNotice">
                {(field) => (
                  <MantineTextInput
                    component="textarea"
                    label="Privacy notice"
                    value={field.state.value}
                    error={firstFormError(field.state.meta.errors)}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    required
                  />
                )}
              </form.Field>
              <form.Field name="profileMappings">
                {(field) => {
                  const survey = surveyVersions.find(
                    (candidate) =>
                      candidate.id === form.getFieldValue("surveyVersionId"),
                  );
                  const questions =
                    survey?.content.sections.flatMap((section) =>
                      section.items.filter(
                        (item) => item.kind !== "instruction",
                      ),
                    ) ?? [];
                  const automaticCurrentRegionQuestion = questions.find(
                    isOperationalRegionQuestion,
                  );
                  return (
                    <Stack gap="sm">
                      <Title order={3}>Profile mappings</Title>
                      {(["name", "phone", "currentRegionId"] as const).map(
                        (destination) => {
                          const selected =
                            field.state.value.find(
                              (mapping) => mapping.destination === destination,
                            )?.questionId ?? "";
                          const compatible = questions.filter((question) =>
                            destination === "name"
                              ? question.kind === "short_text" ||
                                question.kind === "long_text"
                              : destination === "phone"
                                ? question.kind === "short_text"
                                : question.kind === "single_choice" ||
                                  question.kind === "dropdown",
                          );
                          return (
                            <MantineNativeSelect
                              key={destination}
                              label={
                                destination === "currentRegionId"
                                  ? "Current region"
                                  : destination === "phone"
                                    ? "Phone number"
                                    : "Full name"
                              }
                              value={selected}
                              disabled={
                                destination === "currentRegionId" &&
                                automaticCurrentRegionQuestion !== undefined
                              }
                              data={
                                destination === "currentRegionId" &&
                                automaticCurrentRegionQuestion
                                  ? [
                                      {
                                        value:
                                          automaticCurrentRegionQuestion.id,
                                        label: `${automaticCurrentRegionQuestion.prompt} (automatic)`,
                                      },
                                    ]
                                  : [
                                      { value: "", label: "Do not update" },
                                      ...compatible.map((question) => ({
                                        value: question.id,
                                        label: question.prompt,
                                      })),
                                    ]
                              }
                              onChange={(event) => {
                                const questionId = event.currentTarget.value;
                                const remaining = field.state.value.filter(
                                  (mapping) =>
                                    mapping.destination !== destination &&
                                    mapping.questionId !== questionId,
                                );
                                field.handleChange(
                                  questionId
                                    ? [
                                        ...remaining,
                                        { destination, questionId },
                                      ]
                                    : remaining,
                                );
                              }}
                            />
                          );
                        },
                      )}
                    </Stack>
                  );
                }}
              </form.Field>
              {error ? <Alert color="red">{error}</Alert> : null}
              <form.Subscribe
                selector={(state) =>
                  [state.canSubmit, state.isSubmitting] as const
                }
              >
                {([canSubmit, isSubmitting]) => (
                  <Group justify="flex-end">
                    <Button
                      type="submit"
                      disabled={!canSubmit}
                      loading={isSubmitting}
                    >
                      Activate new version
                    </Button>
                  </Group>
                )}
              </form.Subscribe>
            </Stack>
          </form>
        </Paper>
      )}
      {history.length > 0 ? (
        <Stack gap="sm">
          <Title order={2}>Version history</Title>
          {history.map((configuration) => (
            <Paper key={configuration.id} withBorder radius="md" p="md">
              <Group justify="space-between" wrap="wrap">
                <div>
                  <Text fw={700}>Version {configuration.version}</Text>
                  <Text size="sm">
                    {configuration.surveyTitle} · Survey v
                    {configuration.surveyVersion}
                  </Text>
                </div>
                <Badge color={configuration.deactivatedAt ? "gray" : "teal"}>
                  {configuration.deactivatedAt ? "Inactive" : "Active"}
                </Badge>
              </Group>
            </Paper>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}
