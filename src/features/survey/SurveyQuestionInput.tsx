import { Stack, Text } from "#/features/shared/mantine";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import type {
  SurveyAnswerValue,
  SurveyQuestion,
} from "#/features/survey/survey.schema";
import { useId, useState } from "react";
import classes from "./SurveyQuestionInput.module.css";

export function SurveyQuestionInput({
  error,
  errorId,
  onChange,
  question,
  value,
}: {
  error: string | undefined;
  errorId: string;
  onChange: (value: SurveyAnswerValue | undefined) => void;
  question: SurveyQuestion;
  value: SurveyAnswerValue | undefined;
}) {
  if (question.kind === "dropdown")
    return (
      <SearchableQuestionSelect
        question={question}
        value={typeof value === "string" ? value : undefined}
        error={error}
        onChange={onChange}
      />
    );
  if (question.kind === "single_choice")
    return (
      <fieldset
        className={classes.fieldset}
        aria-describedby={error ? errorId : undefined}
      >
        {question.options.map((option) => (
          <label className={classes.choice} key={option.id}>
            <input
              type="radio"
              name={question.id}
              value={option.id}
              checked={value === option.id}
              onChange={() => {
                onChange(option.id);
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
        <FieldError error={error} errorId={errorId} />
      </fieldset>
    );
  if (question.kind === "multiple_choice") {
    const selected = new Set(Array.isArray(value) ? value : []);
    return (
      <Stack
        gap="xs"
        role="group"
        aria-label={question.prompt}
        aria-describedby={error ? errorId : undefined}
      >
        {question.options.map((option) => (
          <MantineCheckbox
            key={option.id}
            label={option.label}
            checked={selected.has(option.id)}
            onChange={(checked) => {
              const next = new Set(selected);
              if (checked) next.add(option.id);
              else next.delete(option.id);
              onChange([...next]);
            }}
          />
        ))}
        <FieldError error={error} errorId={errorId} />
      </Stack>
    );
  }
  if (question.kind === "checkbox")
    return (
      <Stack gap="xs">
        <MantineCheckbox
          label={question.prompt}
          checked={value === true}
          onChange={(checked) => {
            onChange(checked);
          }}
        />
        <FieldError error={error} errorId={errorId} />
      </Stack>
    );
  if (question.kind === "rating")
    return (
      <select
        className={classes.select}
        aria-label={question.prompt}
        aria-invalid={Boolean(error)}
        value={typeof value === "number" ? String(value) : ""}
        onChange={(event) => {
          const next = event.currentTarget.value;
          onChange(next ? Number(next) : undefined);
        }}
      >
        <option value="">Choose a rating</option>
        {Array.from(
          { length: question.maximum - question.minimum + 1 },
          (_, index) => question.minimum + index,
        ).map((rating) => {
          const endpoint =
            rating === question.minimum
              ? question.minimumLabel
              : rating === question.maximum
                ? question.maximumLabel
                : "";
          return (
            <option key={rating} value={rating}>
              {endpoint ? `${String(rating)} — ${endpoint}` : rating}
            </option>
          );
        })}
      </select>
    );
  if (question.kind === "number")
    return (
      <MantineTextInput
        aria-label={question.prompt}
        error={error}
        type="number"
        min={question.minimum ?? undefined}
        max={question.maximum ?? undefined}
        step={question.integer ? "1" : "any"}
        value={typeof value === "number" ? String(value) : ""}
        onChange={(event) => {
          const next = event.currentTarget.value;
          onChange(next ? Number(next) : undefined);
        }}
      />
    );
  if (question.kind === "date")
    return (
      <MantineTextInput
        aria-label={question.prompt}
        error={error}
        type="date"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => {
          onChange(event.currentTarget.value || undefined);
        }}
      />
    );
  return (
    <MantineTextInput
      component={question.kind === "long_text" ? "textarea" : undefined}
      aria-label={question.prompt}
      error={error}
      inputMode={
        question.kind === "short_text" && question.format === "email"
          ? "email"
          : question.kind === "short_text" && question.format === "phone"
            ? "tel"
            : question.kind === "short_text" && question.format === "url"
              ? "url"
              : "text"
      }
      maxLength={question.maximumLength}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
    />
  );
}

function SearchableQuestionSelect({
  error,
  onChange,
  question,
  value,
}: {
  error: string | undefined;
  onChange: (value: SurveyAnswerValue | undefined) => void;
  question: Extract<SurveyQuestion, { kind: "dropdown" }>;
  value: string | undefined;
}) {
  const listId = useId();
  const selectedLabel =
    question.options.find((option) => option.id === value)?.label ?? "";
  const [query, setQuery] = useState(selectedLabel);
  return (
    <MantineTextInput
      aria-label={question.prompt}
      autoComplete="off"
      error={error}
      list={listId}
      placeholder="Search or choose an answer"
      value={query}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setQuery(next);
        const match = question.options.find(
          (option) =>
            option.label.toLocaleLowerCase("en-AU") ===
            next.toLocaleLowerCase("en-AU"),
        );
        onChange(match?.id);
      }}
      onBlur={() => {
        const match = question.options.find(
          (option) =>
            option.label.toLocaleLowerCase("en-AU") ===
            query.toLocaleLowerCase("en-AU"),
        );
        setQuery(match?.label ?? "");
        onChange(match?.id);
      }}
    >
      <datalist id={listId}>
        {question.options.map((option) => (
          <option value={option.label} key={option.id} />
        ))}
      </datalist>
    </MantineTextInput>
  );
}

function FieldError({
  error,
  errorId,
}: {
  error: string | undefined;
  errorId: string;
}) {
  return error ? (
    <Text id={errorId} c="red" size="sm" role="alert">
      {error}
    </Text>
  ) : null;
}
