import {
  Alert,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { useState, type SyntheticEvent } from "react";
import classes from "./learner-survey.module.css";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineProgress } from "#/features/shared/MantineProgress";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import {
  learnerSurveyParamsSchema,
  type LearnerSurveyProgress,
  type SurveyAnswerValue,
} from "#/features/survey/survey.schema";
import {
  advanceLearnerSurveyStep,
  getLearnerSurvey,
} from "#/server/functions/learner";

export const Route = createFileRoute(
  "/learn/$enrollmentId_/surveys/$courseVersionItemId",
)({
  ssr: "data-only",
  loader: async ({ params }) => {
    const parsed = learnerSurveyParamsSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getLearnerSurvey({ data: parsed.data });
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: {
          redirect: `/learn/${encodeURIComponent(parsed.data.enrollmentId)}/surveys/${encodeURIComponent(parsed.data.courseVersionItemId)}`,
        },
      });
    if (result.status === "not-found") throw notFound();
    if (result.status === "unavailable")
      throw redirect({
        to: "/learn/$enrollmentId",
        params: { enrollmentId: parsed.data.enrollmentId },
      });
    return result.data;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.content.title} — ${loaderData.courseTitle}`
          : "Survey — Upskill",
      },
    ],
  }),
  component: LearnerSurveyPage,
});

function LearnerSurveyPage() {
  const survey = Route.useLoaderData();
  const steps = survey.content.sections.flatMap((section, sectionIndex) =>
    section.items.map((item) => ({ item, section, sectionIndex })),
  );
  const initialIndex = Math.max(
    0,
    steps.findIndex((step) => step.item.id === survey.progress.currentItemId),
  );
  const [displayIndex, setDisplayIndex] = useState(initialIndex);
  const [answers, setAnswers] = useState(survey.progress.answers);
  const [progress, setProgress] = useState<LearnerSurveyProgress>(
    survey.progress,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  if (survey.submittedAt || progress.completedAt)
    return (
      <Container size="sm" py="xl">
        <Stack gap="lg">
          <Alert color="green" title="Survey completed">
            Your response was submitted. This course item is complete.
          </Alert>
          <Link
            to="/learn/$enrollmentId"
            params={{ enrollmentId: survey.enrollmentId }}
          >
            <Button component="span" variant="light">
              Return to course
            </Button>
          </Link>
        </Stack>
      </Container>
    );

  const step = steps[displayIndex];
  if (!step)
    return (
      <Container size="sm" py="xl">
        <Alert color="red" title="Survey unavailable">
          This survey does not contain any items. Return to the course and try
          again later.
        </Alert>
      </Container>
    );

  const { item, section, sectionIndex } = step;
  const sectionProgress = progress.sections.find(
    (candidate) => candidate.id === section.id,
  );

  async function advance(
    event: SyntheticEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const answer = item.kind === "instruction" ? undefined : answers[item.id];
      const result = await advanceLearnerSurveyStep({
        data: {
          enrollmentId: survey.enrollmentId,
          courseVersionItemId: survey.courseVersionItemId,
          itemId: item.id,
          ...(typeof answer === "undefined" ? {} : { answer }),
        },
      });
      if (result.status === "invalid") {
        setError(result.message);
        return;
      }
      if (result.status !== "advanced" && result.status !== "submitted") {
        setError(
          "Progress could not be saved. Return to the course and try again.",
        );
        return;
      }
      setProgress(result.progress);
      setAnswers(result.progress.answers);
      if (result.status === "advanced")
        setDisplayIndex((current) => Math.min(current + 1, steps.length - 1));
    } finally {
      setSubmitting(false);
    }
  }

  const answer: SurveyAnswerValue | undefined = answers[item.id];
  return (
    <Container size="sm" py="xl">
      <Stack gap="xl">
        <div>
          <Text c="indigo.7" fw={700}>
            {survey.sectionTitle}
          </Text>
          <Title order={1}>{survey.content.title}</Title>
          {survey.content.description ? (
            <Text c="dimmed" mt="xs">
              {survey.content.description}
            </Text>
          ) : null}
        </div>

        <Paper withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Group justify="space-between" align="baseline">
              <Text fw={700}>Overall progress</Text>
              <Text size="sm" c="dimmed">
                {progress.completedItems} of {progress.totalItems}
              </Text>
            </Group>
            <MantineProgress
              aria-label="Overall survey progress"
              value={progress.percent}
            />
            <Group justify="space-between" align="baseline">
              <Text fw={700}>
                Section {String(sectionIndex + 1)}: {section.title}
              </Text>
              <Text size="sm" c="dimmed">
                {sectionProgress?.completedItems ?? 0} of{" "}
                {sectionProgress?.totalItems ?? section.items.length}
              </Text>
            </Group>
            <MantineProgress
              aria-label={`${section.title} progress`}
              value={sectionProgress?.percent ?? 0}
            />
            {section.description ? (
              <Text c="dimmed">{section.description}</Text>
            ) : null}
          </Stack>
        </Paper>

        <form onSubmit={(event) => void advance(event)}>
          <Stack gap="lg">
            <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
              <Stack gap="md">
                <Text size="sm" c="dimmed" fw={600}>
                  Item {String(displayIndex + 1)} of {String(steps.length)}
                </Text>
                {item.kind === "instruction" ? (
                  <>
                    <Title order={2}>{item.title}</Title>
                    <Text className={classes.instructionBody}>{item.body}</Text>
                  </>
                ) : (
                  <>
                    <Title order={2} size="h3">
                      {item.prompt}
                      {item.required ? " *" : ""}
                    </Title>
                    {item.kind === "single_choice" ? (
                      <MantineNativeSelect
                        aria-label={item.prompt}
                        value={typeof answer === "string" ? answer : ""}
                        data={[
                          { value: "", label: "Choose an answer" },
                          ...item.options.map((option) => ({
                            value: option.id,
                            label: option.label,
                          })),
                        ]}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setAnswers((current) => ({
                            ...current,
                            [item.id]: value,
                          }));
                        }}
                      />
                    ) : item.kind === "multiple_choice" ? (
                      <Stack gap="xs">
                        {item.options.map((option) => {
                          const selected = Array.isArray(answer) ? answer : [];
                          return (
                            <MantineCheckbox
                              key={option.id}
                              label={option.label}
                              checked={selected.includes(option.id)}
                              onChange={(checked) => {
                                setAnswers((current) => ({
                                  ...current,
                                  [item.id]: checked
                                    ? [...selected, option.id]
                                    : selected.filter((id) => id !== option.id),
                                }));
                              }}
                            />
                          );
                        })}
                      </Stack>
                    ) : (
                      <MantineTextInput
                        component="textarea"
                        aria-label={item.prompt}
                        maxLength={item.maximumLength}
                        value={typeof answer === "string" ? answer : ""}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setAnswers((current) => ({
                            ...current,
                            [item.id]: value,
                          }));
                        }}
                      />
                    )}
                  </>
                )}
              </Stack>
            </Paper>
            {error ? <Alert color="red">{error}</Alert> : null}
            <Group justify="space-between" wrap="wrap">
              {displayIndex > 0 ? (
                <Button
                  variant="default"
                  disabled={submitting}
                  onClick={() => {
                    setError(undefined);
                    setDisplayIndex((current) => current - 1);
                  }}
                >
                  Previous
                </Button>
              ) : (
                <Link
                  to="/learn/$enrollmentId"
                  params={{ enrollmentId: survey.enrollmentId }}
                >
                  <Button component="span" variant="default">
                    Return to course
                  </Button>
                </Link>
              )}
              <Button type="submit" loading={submitting}>
                {displayIndex === steps.length - 1 ? "Complete survey" : "Next"}
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Container>
  );
}
