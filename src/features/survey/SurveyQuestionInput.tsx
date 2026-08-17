import { Stack, Text } from "#/features/shared/mantine";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import type {
  SurveyAnswerValue,
  SurveyQuestion,
} from "#/features/survey/survey.schema";
import classes from "./SurveyQuestionInput.module.css";
import { SurveyLocalDateInput } from "./SurveyLocalDateInput";

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
      <DropdownQuestionSelect
        question={question}
        value={typeof value === "string" ? value : undefined}
        error={error}
        errorId={errorId}
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
      <SurveyLocalDateInput
        aria-label={question.prompt}
        error={error}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
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

function DropdownQuestionSelect({
  error,
  errorId,
  onChange,
  question,
  value,
}: {
  error: string | undefined;
  errorId: string;
  onChange: (value: SurveyAnswerValue | undefined) => void;
  question: Extract<SurveyQuestion, { kind: "dropdown" }>;
  value: string | undefined;
}) {
  const unavailable =
    question.optionSource === "coordination_operational_regions" &&
    question.options.length === 0;
  return (
    <Stack gap="xs">
      <select
        className={classes.select}
        aria-label={question.prompt}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        disabled={unavailable}
        value={value ?? ""}
        onChange={(event) => {
          onChange(event.currentTarget.value || undefined);
        }}
      >
        <option value="">
          {unavailable ? "Choose a region group first" : "Choose an answer"}
        </option>
        {question.options.map((option) => (
          <option value={option.id} key={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldError error={error} errorId={errorId} />
    </Stack>
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
