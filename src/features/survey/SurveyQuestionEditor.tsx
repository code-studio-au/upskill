import { Badge, Button, Card, Group, Stack, TextInput } from "@mantine/core";
import type { SurveyQuestion } from "./survey.schema";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";

export function SurveyQuestionEditor({
  disabled,
  index,
  onChange,
  onMove,
  onRemove,
  question,
  total,
}: {
  disabled: boolean;
  index: number;
  onChange: (question: SurveyQuestion) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  question: SurveyQuestion;
  total: number;
}) {
  return (
    <Card withBorder radius="lg" padding="lg">
      <Stack gap="md">
        <Group justify="space-between" align="start" wrap="wrap">
          <Badge variant="light">
            {question.kind === "single_choice"
              ? "Single choice"
              : question.kind === "multiple_choice"
                ? "Multiple choice"
                : "Written response"}
          </Badge>
          {!disabled ? (
            <Group gap="xs">
              <Button
                size="compact-xs"
                variant="default"
                disabled={index === 0}
                onClick={() => {
                  onMove(-1);
                }}
              >
                Up
              </Button>
              <Button
                size="compact-xs"
                variant="default"
                disabled={index === total - 1}
                onClick={() => {
                  onMove(1);
                }}
              >
                Down
              </Button>
              <Button
                size="compact-xs"
                color="red"
                variant="subtle"
                onClick={onRemove}
              >
                Remove
              </Button>
            </Group>
          ) : null}
        </Group>
        <TextInput
          component="textarea"
          label={`Question ${String(index + 1)}`}
          value={question.prompt}
          disabled={disabled}
          onChange={(event) => {
            const prompt = event.currentTarget.value;
            onChange({ ...question, prompt });
          }}
          required
        />
        <MantineCheckbox
          label="A response is required"
          checked={question.required}
          disabled={disabled}
          onChange={(required) => {
            onChange({ ...question, required });
          }}
        />
        {question.kind === "text" ? (
          <TextInput
            type="number"
            label="Maximum response length"
            min={1}
            max={2_000}
            value={String(question.maximumLength)}
            disabled={disabled}
            onChange={(event) => {
              const maximumLength = Number(event.currentTarget.value);
              onChange({
                ...question,
                maximumLength: Number.isFinite(maximumLength)
                  ? maximumLength
                  : 2_000,
              });
            }}
          />
        ) : (
          <Stack gap="xs">
            {question.options.map((option, optionIndex) => (
              <Group key={option.id} align="end" wrap="nowrap">
                <TextInput
                  label={`Option ${String(optionIndex + 1)}`}
                  value={option.label}
                  disabled={disabled}
                  onChange={(event) => {
                    const label = event.currentTarget.value;
                    onChange({
                      ...question,
                      options: question.options.map((candidate) =>
                        candidate.id === option.id
                          ? { ...candidate, label }
                          : candidate,
                      ),
                    });
                  }}
                  required
                  flex={1}
                />
                {!disabled ? (
                  <Button
                    color="red"
                    variant="subtle"
                    disabled={question.options.length <= 2}
                    onClick={() => {
                      onChange({
                        ...question,
                        options: question.options.filter(
                          (candidate) => candidate.id !== option.id,
                        ),
                      });
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </Group>
            ))}
            {!disabled ? (
              <Button
                variant="light"
                size="xs"
                onClick={() => {
                  onChange({
                    ...question,
                    options: [
                      ...question.options,
                      {
                        id: `option_${crypto.randomUUID()}`,
                        label: `Option ${String(question.options.length + 1)}`,
                      },
                    ],
                  });
                }}
              >
                Add option
              </Button>
            ) : null}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
