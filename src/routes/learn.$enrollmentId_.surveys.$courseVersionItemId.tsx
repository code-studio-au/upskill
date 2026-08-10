import {
  Alert,
  Button,
  Container,
  Group,
  NativeSelect,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState, type SyntheticEvent } from "react";
import { learnerSurveyParamsSchema } from "#/features/survey/survey.schema";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import {
  getLearnerSurvey,
  submitLearnerSurveyResponse,
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

type AnswerValue = string | Array<string>;

function LearnerSurveyPage() {
  const survey = Route.useLoaderData();
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  if (survey.submittedAt)
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

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await submitLearnerSurveyResponse({
        data: {
          enrollmentId: survey.enrollmentId,
          courseVersionItemId: survey.courseVersionItemId,
          answers: Object.entries(answers).map(([questionId, value]) => ({
            questionId,
            value,
          })),
        },
      });
      if (result.status === "invalid") {
        setError(result.message);
        return;
      }
      if (result.status !== "submitted") {
        setError(
          "The survey could not be submitted. Return to the course and try again.",
        );
        return;
      }
      await router.invalidate();
    } finally {
      setSubmitting(false);
    }
  }

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
        <form onSubmit={(event) => void submit(event)}>
          <Stack gap="lg">
            {survey.content.questions.map((question, index) => (
              <Paper key={question.id} withBorder radius="lg" p="lg">
                <Stack gap="sm">
                  <Text fw={600}>
                    {String(index + 1)}. {question.prompt}
                    {question.required ? " *" : ""}
                  </Text>
                  {question.kind === "single_choice" ? (
                    <NativeSelect
                      aria-label={question.prompt}
                      value={
                        typeof answers[question.id] === "string"
                          ? (answers[question.id] as string)
                          : ""
                      }
                      data={[
                        { value: "", label: "Choose an answer" },
                        ...question.options.map((option) => ({
                          value: option.id,
                          label: option.label,
                        })),
                      ]}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setAnswers((current) => ({
                          ...current,
                          [question.id]: value,
                        }));
                      }}
                    />
                  ) : question.kind === "multiple_choice" ? (
                    <Stack gap="xs">
                      {question.options.map((option) => {
                        const selected = Array.isArray(answers[question.id])
                          ? (answers[question.id] as Array<string>)
                          : [];
                        return (
                          <MantineCheckbox
                            key={option.id}
                            label={option.label}
                            checked={selected.includes(option.id)}
                            onChange={(checked) => {
                              setAnswers((current) => ({
                                ...current,
                                [question.id]: checked
                                  ? [...selected, option.id]
                                  : selected.filter((id) => id !== option.id),
                              }));
                            }}
                          />
                        );
                      })}
                    </Stack>
                  ) : (
                    <TextInput
                      component="textarea"
                      aria-label={question.prompt}
                      maxLength={question.maximumLength}
                      value={
                        typeof answers[question.id] === "string"
                          ? (answers[question.id] as string)
                          : ""
                      }
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setAnswers((current) => ({
                          ...current,
                          [question.id]: value,
                        }));
                      }}
                    />
                  )}
                </Stack>
              </Paper>
            ))}
            {error ? <Alert color="red">{error}</Alert> : null}
            <Group justify="space-between">
              <Link
                to="/learn/$enrollmentId"
                params={{ enrollmentId: survey.enrollmentId }}
              >
                <Button component="span" variant="default">
                  Return to course
                </Button>
              </Link>
              <Button type="submit" loading={submitting}>
                Submit survey
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Container>
  );
}
