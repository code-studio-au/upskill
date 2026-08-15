import {
  Alert,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineProgress } from "#/features/shared/MantineProgress";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { useForm } from "@tanstack/react-form";
import { useState, type ReactNode } from "react";
import type {
  LearnerSurveyProgress,
  LearnerSurveyStepResult,
  SurveyAnswerValue,
  SurveyVersionContent,
} from "#/features/survey/survey.schema";
import classes from "./LearnerSurveyExperience.module.css";

interface SurveyExperience {
  sectionTitle: string;
  content: SurveyVersionContent;
  progress: LearnerSurveyProgress;
  submittedAt: string | null;
}

export function LearnerSurveyExperience({
  survey,
  returnAction,
  completionDescription,
  onAdvance,
}: {
  survey: SurveyExperience;
  returnAction: ReactNode;
  completionDescription: string;
  onAdvance: (
    itemId: string,
    answer: SurveyAnswerValue | undefined,
  ) => Promise<LearnerSurveyStepResult>;
}) {
  const steps = survey.content.sections.flatMap((section, sectionIndex) =>
    section.items.map((item) => ({ item, section, sectionIndex })),
  );
  const initialIndex = Math.max(
    0,
    steps.findIndex((step) => step.item.id === survey.progress.currentItemId),
  );
  const [displayIndex, setDisplayIndex] = useState(initialIndex);
  const [answers, setAnswers] = useState(survey.progress.answers);
  const [progress, setProgress] = useState(survey.progress);
  const [error, setError] = useState<string>();
  const answerForm = useForm({
    defaultValues: {
      answer: steps[initialIndex]?.item.id
        ? survey.progress.answers[steps[initialIndex].item.id]
        : undefined,
    },
    validators: {
      onSubmit: ({ value }) => {
        const item = steps[displayIndex]?.item;
        if (!item || item.kind === "instruction" || !item.required)
          return undefined;
        if (typeof value.answer === "string" && value.answer.trim())
          return undefined;
        if (Array.isArray(value.answer) && value.answer.length > 0)
          return undefined;
        return {
          fields: { answer: "Answer this question before continuing." },
        };
      },
    },
    onSubmit: async ({ value }) => {
      const current = steps[displayIndex];
      if (!current) return;
      setError(undefined);
      const result = await onAdvance(
        current.item.id,
        current.item.kind === "instruction" ? undefined : value.answer,
      );
      if (result.status === "invalid") {
        setError(result.message);
        return;
      }
      if (result.status !== "advanced" && result.status !== "submitted") {
        setError("Progress could not be saved. Return and try again.");
        return;
      }
      setProgress(result.progress);
      setAnswers(result.progress.answers);
      if (result.status === "advanced") {
        const nextIndex = Math.min(displayIndex + 1, steps.length - 1);
        const next = steps[nextIndex]?.item;
        answerForm.reset({
          answer: next ? result.progress.answers[next.id] : undefined,
        });
        setDisplayIndex(nextIndex);
      }
    },
  });

  if (survey.submittedAt || progress.completedAt)
    return (
      <Container size="sm" py="xl">
        <Stack gap="lg">
          <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
            <Title order={1}>Survey completed</Title>
            <Text c="dimmed" mt="xs">
              {completionDescription}
            </Text>
          </Paper>
          {returnAction}
        </Stack>
      </Container>
    );
  const step = steps[displayIndex];
  if (!step)
    return (
      <Container size="sm" py="xl">
        <Stack gap="md">
          <Title order={1}>Survey unavailable</Title>
          <Alert color="red">This survey does not contain any items.</Alert>
          {returnAction}
        </Stack>
      </Container>
    );
  const { item, section, sectionIndex } = step;
  const sectionProgress = progress.sections.find(
    (candidate) => candidate.id === section.id,
  );
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
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={700}>Overall progress</Text>
              <Text size="sm" c="dimmed">
                {progress.completedItems} of {progress.totalItems}
              </Text>
            </Group>
            <MantineProgress
              aria-label="Overall survey progress"
              value={progress.percent}
            />
            <Group justify="space-between">
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
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void answerForm.handleSubmit();
          }}
        >
          <Stack gap="lg">
            <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
              <Stack gap="md">
                <Text size="sm" c="dimmed">
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
                    <answerForm.Field name="answer">
                      {(field) =>
                        item.kind === "single_choice" ? (
                          <MantineNativeSelect
                            aria-label={item.prompt}
                            value={
                              typeof field.state.value === "string"
                                ? field.state.value
                                : ""
                            }
                            data={[
                              { value: "", label: "Choose an answer" },
                              ...item.options.map((option) => ({
                                value: option.id,
                                label: option.label,
                              })),
                            ]}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              field.handleChange(value);
                              setAnswers((current) => ({
                                ...current,
                                [item.id]: value,
                              }));
                            }}
                          />
                        ) : item.kind === "multiple_choice" ? (
                          <Stack gap="xs" role="group" aria-label={item.prompt}>
                            {item.options.map((option) => {
                              const selected = Array.isArray(field.state.value)
                                ? field.state.value
                                : [];
                              return (
                                <MantineCheckbox
                                  key={option.id}
                                  label={option.label}
                                  checked={selected.includes(option.id)}
                                  onChange={(checked) => {
                                    const value = checked
                                      ? [...selected, option.id]
                                      : selected.filter(
                                          (id) => id !== option.id,
                                        );
                                    field.handleChange(value);
                                    setAnswers((current) => ({
                                      ...current,
                                      [item.id]: value,
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
                            value={
                              typeof field.state.value === "string"
                                ? field.state.value
                                : ""
                            }
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              field.handleChange(value);
                              setAnswers((current) => ({
                                ...current,
                                [item.id]: value,
                              }));
                            }}
                          />
                        )
                      }
                    </answerForm.Field>
                  </>
                )}
              </Stack>
            </Paper>
            {error ? <Alert color="red">{error}</Alert> : null}
            <answerForm.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Group justify="space-between" wrap="wrap">
                  {displayIndex > 0 ? (
                    <Button
                      type="button"
                      variant="default"
                      disabled={isSubmitting}
                      onClick={() => {
                        const previousIndex = displayIndex - 1;
                        const previous = steps[previousIndex]?.item;
                        answerForm.reset({
                          answer: previous ? answers[previous.id] : undefined,
                        });
                        setDisplayIndex(previousIndex);
                      }}
                    >
                      Previous
                    </Button>
                  ) : (
                    returnAction
                  )}
                  <Button type="submit" loading={isSubmitting}>
                    {displayIndex === steps.length - 1
                      ? "Complete survey"
                      : "Next"}
                  </Button>
                </Group>
              )}
            </answerForm.Subscribe>
          </Stack>
        </form>
      </Stack>
    </Container>
  );
}
