import { Badge } from "#/features/shared/Badge";
import { Button, Group, Paper, Stack, Text } from "#/features/shared/mantine";
import type { SurveyItem, SurveyQuestion } from "./survey.schema";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { useState } from "react";
import { SurveyLocalDateInput } from "./SurveyLocalDateInput";

const questionLabels: Record<SurveyQuestion["kind"], string> = {
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  dropdown: "Dropdown",
  short_text: "Short text",
  long_text: "Long text",
  checkbox: "Checkbox",
  number: "Number",
  date: "Date",
  rating: "Rating",
};

export function SurveyQuestionEditor({
  branchSections,
  disabled,
  index,
  item,
  onChange,
  onMove,
  onRemove,
  total,
}: {
  branchSections: Array<{ id: string; title: string }>;
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
  const questionLabel =
    question.kind === "dropdown" &&
    question.optionSource === "coordination_region_groups"
      ? "Region group"
      : question.kind === "dropdown" &&
          question.optionSource === "coordination_operational_regions"
        ? "Operational region"
        : questionLabels[question.kind];
  return (
    <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }} data-survey-item>
      <Stack gap="md">
        <ItemActions
          badge={questionLabel}
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
          disabled={disabled || question.profileField !== undefined}
          onChange={(required) => {
            onChange({ ...question, required });
          }}
        />
        <QuestionSettings
          branchSections={branchSections}
          disabled={disabled}
          question={question}
          onChange={onChange}
        />
      </Stack>
    </Paper>
  );
}

function QuestionSettings({
  branchSections,
  disabled,
  onChange,
  question,
}: {
  branchSections: Array<{ id: string; title: string }>;
  disabled: boolean;
  onChange: (question: SurveyQuestion) => void;
  question: SurveyQuestion;
}) {
  if (question.profileField) return null;
  if (
    question.kind === "single_choice" ||
    question.kind === "multiple_choice" ||
    question.kind === "dropdown"
  ) {
    if (
      question.kind === "dropdown" &&
      (question.optionSource === "coordination_region_groups" ||
        question.optionSource === "coordination_operational_regions")
    )
      return (
        <Paper withBorder radius="md" p="md">
          <Stack gap="xs">
            <Group justify="space-between">
              <Text fw={700}>Directory options</Text>
              <Badge variant="light">Locked</Badge>
            </Group>
            <Text size="sm">{question.options.length} active options</Text>
          </Stack>
        </Paper>
      );
    return (
      <OptionsEditor
        branchSections={branchSections}
        disabled={disabled}
        question={question}
        onChange={onChange}
      />
    );
  }
  if (question.kind === "short_text" || question.kind === "long_text")
    return (
      <Group align="end" grow>
        <MantineTextInput
          type="number"
          label="Maximum response length"
          min={1}
          max={question.kind === "short_text" ? 500 : 10_000}
          value={String(question.maximumLength)}
          disabled={disabled}
          onChange={(event) => {
            const maximumLength = Number(event.currentTarget.value);
            onChange({
              ...question,
              maximumLength: Number.isFinite(maximumLength)
                ? maximumLength
                : question.kind === "short_text"
                  ? 240
                  : 2_000,
            });
          }}
        />
        {question.kind === "short_text" ? (
          <MantineNativeSelect
            label="Response format"
            disabled={disabled}
            value={question.format}
            data={[
              { value: "plain", label: "Plain text" },
              { value: "email", label: "Email address" },
              { value: "phone", label: "Phone number" },
              { value: "url", label: "Web address" },
            ]}
            onChange={(event) => {
              onChange({
                ...question,
                format: event.currentTarget.value as typeof question.format,
              });
            }}
          />
        ) : null}
      </Group>
    );
  if (question.kind === "number")
    return (
      <Group align="end" grow>
        <MantineCheckbox
          label="Whole numbers only"
          checked={question.integer}
          disabled={disabled}
          onChange={(integer) => {
            onChange({ ...question, integer });
          }}
        />
        <NullableNumberSetting
          label="Minimum"
          value={question.minimum}
          disabled={disabled}
          onChange={(minimum) => {
            onChange({ ...question, minimum });
          }}
        />
        <NullableNumberSetting
          label="Maximum"
          value={question.maximum}
          disabled={disabled}
          onChange={(maximum) => {
            onChange({ ...question, maximum });
          }}
        />
      </Group>
    );
  if (question.kind === "date")
    return (
      <Group align="end" grow>
        <SurveyLocalDateInput
          label="Earliest date"
          value={question.minimum ?? ""}
          disabled={disabled}
          onChange={(value) => {
            onChange({
              ...question,
              minimum: value ?? null,
            });
          }}
        />
        <SurveyLocalDateInput
          label="Latest date"
          value={question.maximum ?? ""}
          disabled={disabled}
          onChange={(value) => {
            onChange({
              ...question,
              maximum: value ?? null,
            });
          }}
        />
      </Group>
    );
  if (question.kind === "rating")
    return (
      <Stack gap="sm">
        <Group align="end" grow>
          <MantineTextInput
            type="number"
            label="Minimum rating"
            min={0}
            max={9}
            value={String(question.minimum)}
            disabled={disabled}
            onChange={(event) => {
              onChange({
                ...question,
                minimum: Number(event.currentTarget.value),
              });
            }}
          />
          <MantineTextInput
            type="number"
            label="Maximum rating"
            min={1}
            max={10}
            value={String(question.maximum)}
            disabled={disabled}
            onChange={(event) => {
              onChange({
                ...question,
                maximum: Number(event.currentTarget.value),
              });
            }}
          />
        </Group>
        <Group align="end" grow>
          <MantineTextInput
            label="Minimum label"
            value={question.minimumLabel}
            disabled={disabled}
            onChange={(event) => {
              onChange({
                ...question,
                minimumLabel: event.currentTarget.value,
              });
            }}
          />
          <MantineTextInput
            label="Maximum label"
            value={question.maximumLabel}
            disabled={disabled}
            onChange={(event) => {
              onChange({
                ...question,
                maximumLabel: event.currentTarget.value,
              });
            }}
          />
        </Group>
      </Stack>
    );
  return null;
}

function NullableNumberSetting({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: number | null) => void;
  value: number | null;
}) {
  return (
    <MantineTextInput
      type="number"
      label={label}
      value={value === null ? "" : String(value)}
      disabled={disabled}
      onChange={(event) => {
        const next = event.currentTarget.value;
        onChange(next ? Number(next) : null);
      }}
    />
  );
}

function OptionsEditor({
  branchSections,
  disabled,
  onChange,
  question,
}: {
  branchSections: Array<{ id: string; title: string }>;
  disabled: boolean;
  onChange: (question: SurveyQuestion) => void;
  question: Extract<
    SurveyQuestion,
    { kind: "single_choice" | "multiple_choice" | "dropdown" }
  >;
}) {
  const [bulkOptions, setBulkOptions] = useState("");
  const [bulkError, setBulkError] = useState<string>();
  const preview = bulkOptions
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.split("\t").map((cell) => cell.trim());
      return cells.length > 1
        ? {
            externalValue: cells[0] || undefined,
            label: cells.slice(1).join(" "),
          }
        : { label: cells[0] ?? "" };
    });
  return (
    <Stack gap="xs">
      {question.options.map((option, optionIndex) => (
        <Group key={option.id} align="end" wrap="nowrap">
          <MantineTextInput
            label={`Learner-facing label ${String(optionIndex + 1)}`}
            placeholder="Enter option label"
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
          <MantineTextInput
            label="External mapping value (not displayed)"
            value={option.externalValue ?? ""}
            disabled={disabled}
            onChange={(event) => {
              const externalValue = event.currentTarget.value;
              onChange({
                ...question,
                options: question.options.map((candidate) =>
                  candidate.id === option.id
                    ? {
                        ...candidate,
                        externalValue: externalValue || undefined,
                      }
                    : candidate,
                ),
              });
            }}
            flex={1}
          />
          {!disabled ? (
            <Group gap="xs" wrap="nowrap">
              <Button
                size="compact-xs"
                variant="default"
                disabled={optionIndex === 0}
                onClick={() => {
                  const options = [...question.options];
                  const current = options[optionIndex];
                  const previous = options[optionIndex - 1];
                  if (!current || !previous) return;
                  [options[optionIndex - 1], options[optionIndex]] = [
                    current,
                    previous,
                  ];
                  onChange({ ...question, options });
                }}
              >
                Up
              </Button>
              <Button
                size="compact-xs"
                variant="default"
                disabled={optionIndex === question.options.length - 1}
                onClick={() => {
                  const options = [...question.options];
                  const current = options[optionIndex];
                  const next = options[optionIndex + 1];
                  if (!current || !next) return;
                  [options[optionIndex], options[optionIndex + 1]] = [
                    next,
                    current,
                  ];
                  onChange({ ...question, options });
                }}
              >
                Down
              </Button>
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
            </Group>
          ) : null}
        </Group>
      ))}
      {(question.kind === "single_choice" || question.kind === "dropdown") &&
      branchSections.length > 0 ? (
        <Paper withBorder radius="md" p="md">
          <Stack gap="sm">
            <Text fw={700}>Conditional logic</Text>
            {question.options.map((option, optionIndex) => (
              <MantineNativeSelect
                key={option.id}
                label={`After “${option.label || `Option ${String(optionIndex + 1)}`}”`}
                disabled={disabled}
                value={option.nextSectionId ?? ""}
                data={[
                  { value: "", label: "Continue normally" },
                  ...branchSections.map((section) => ({
                    value: section.id,
                    label: `Continue at ${section.title}`,
                  })),
                ]}
                onChange={(event) => {
                  const nextSectionId = event.currentTarget.value;
                  onChange({
                    ...question,
                    options: question.options.map((candidate) =>
                      candidate.id === option.id
                        ? {
                            ...candidate,
                            nextSectionId: nextSectionId || undefined,
                          }
                        : candidate,
                    ),
                  });
                }}
              />
            ))}
          </Stack>
        </Paper>
      ) : null}
      {!disabled ? (
        <>
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
          <MantineTextInput
            component="textarea"
            label="Bulk add options"
            placeholder="Paste one option per line"
            value={bulkOptions}
            onChange={(event) => {
              setBulkOptions(event.currentTarget.value);
              setBulkError(undefined);
            }}
          />
          {preview.length > 0 ? (
            <Paper withBorder radius="md" p="md">
              <Stack gap="xs">
                <Text fw={700}>Preview · {preview.length} options</Text>
                {preview.slice(0, 8).map((option) => (
                  <Text
                    size="sm"
                    key={`${option.externalValue ?? "label"}-${option.label}`}
                  >
                    {option.externalValue ? `${option.externalValue} — ` : ""}
                    {option.label}
                  </Text>
                ))}
                {preview.length > 8 ? (
                  <Text size="sm">…and {preview.length - 8} more</Text>
                ) : null}
              </Stack>
            </Paper>
          ) : null}
          {bulkError ? (
            <Text c="red" size="sm" role="alert">
              {bulkError}
            </Text>
          ) : null}
          <Button
            variant="default"
            size="xs"
            disabled={!bulkOptions.trim()}
            onClick={() => {
              const labels = new Set(
                question.options.map((option) =>
                  option.label.toLocaleLowerCase("en-AU"),
                ),
              );
              const externalValues = new Set(
                question.options.flatMap((option) =>
                  option.externalValue
                    ? [option.externalValue.toLocaleLowerCase("en-AU")]
                    : [],
                ),
              );
              if (question.options.length + preview.length > 500) {
                setBulkError("A question may contain at most 500 options.");
                return;
              }
              for (const option of preview) {
                const label = option.label.toLocaleLowerCase("en-AU");
                const externalValue =
                  option.externalValue?.toLocaleLowerCase("en-AU");
                if (
                  !option.label ||
                  labels.has(label) ||
                  (externalValue && externalValues.has(externalValue))
                ) {
                  setBulkError(
                    "Pasted labels and external values must be non-empty and unique.",
                  );
                  return;
                }
                labels.add(label);
                if (externalValue) externalValues.add(externalValue);
              }
              const options = preview.map((option) => ({
                id: `option_${crypto.randomUUID()}`,
                ...option,
              }));
              onChange({
                ...question,
                options: [...question.options, ...options],
              });
              setBulkOptions("");
              setBulkError(undefined);
            }}
          >
            Add pasted options
          </Button>
        </>
      ) : null}
    </Stack>
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
