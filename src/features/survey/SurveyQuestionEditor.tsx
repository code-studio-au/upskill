import { Badge } from "#/features/shared/Badge";
import { Button, Group, Paper, Stack } from "#/features/shared/mantine";
import type { SurveyItem, SurveyQuestion } from "./survey.schema";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineTextInput } from "#/features/shared/MantineTextInput";

export function SurveyQuestionEditor({
  disabled,
  index,
  item,
  onChange,
  onMove,
  onRemove,
  total,
}: {
  disabled: boolean;
  index: number;
  item: SurveyItem;
  onChange: (item: SurveyItem) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  total: number;
}) {
  if (item.kind === "instruction")
    return (
      <Paper
        withBorder
        radius="lg"
        p={{ base: "md", sm: "lg" }}
        data-survey-item
      >
        <Stack gap="md">
          <ItemActions
            badge="Text / instruction"
            disabled={disabled}
            index={index}
            total={total}
            onMove={onMove}
            onRemove={onRemove}
          />
          <MantineTextInput
            label="Block title"
            value={item.title}
            disabled={disabled}
            onChange={(event) => {
              const title = event.currentTarget.value;
              onChange({ ...item, title });
            }}
            required
          />
          <MantineTextInput
            component="textarea"
            label="Instructions"
            value={item.body}
            disabled={disabled}
            maxLength={10_000}
            onChange={(event) => {
              const body = event.currentTarget.value;
              onChange({ ...item, body });
            }}
            required
          />
        </Stack>
      </Paper>
    );

  const question: SurveyQuestion = item;
  return (
    <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }} data-survey-item>
      <Stack gap="md">
        <ItemActions
          badge={
            question.kind === "single_choice"
              ? "Single choice"
              : question.kind === "multiple_choice"
                ? "Multiple choice"
                : "Written response"
          }
          disabled={disabled}
          index={index}
          total={total}
          onMove={onMove}
          onRemove={onRemove}
        />
        <MantineTextInput
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
          <MantineTextInput
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
                <MantineTextInput
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
    </Paper>
  );
}

function ItemActions({
  badge,
  disabled,
  index,
  onMove,
  onRemove,
  total,
}: {
  badge: string;
  disabled: boolean;
  index: number;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  total: number;
}) {
  return (
    <Group justify="space-between" align="start" wrap="wrap">
      <Badge variant="light">{badge}</Badge>
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
  );
}
