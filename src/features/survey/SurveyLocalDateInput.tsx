import { useEffect, useRef, useState } from "react";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import {
  formatSurveyLocalDate,
  maskSurveyLocalDate,
  parseSurveyLocalDate,
} from "./survey-local-date";

const invalidSurveyDate = "invalid-survey-date";

export function SurveyLocalDateInput({
  "aria-label": ariaLabel,
  disabled,
  error,
  label,
  onChange,
  value,
}: {
  "aria-label"?: string;
  disabled?: boolean;
  error?: string | undefined;
  label?: string;
  onChange: (value: string | undefined) => void;
  value: string | null | undefined;
}) {
  const lastEmittedValue = useRef<string | null | undefined>(null);
  const [displayValue, setDisplayValue] = useState(() =>
    formatSurveyLocalDate(value),
  );
  const [touched, setTouched] = useState(false);
  const parsedValue = parseSurveyLocalDate(displayValue);
  const visibleError =
    touched && parsedValue === null ? "Use DD/MM/YYYY." : error;

  useEffect(() => {
    if (lastEmittedValue.current === value) {
      lastEmittedValue.current = null;
      return;
    }
    setDisplayValue(formatSurveyLocalDate(value));
  }, [value]);

  return (
    <MantineTextInput
      aria-label={ariaLabel ?? label ?? "Date"}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      {...(label === undefined ? {} : { label })}
      placeholder="DD/MM/YYYY"
      maxLength={10}
      value={displayValue}
      {...(disabled === undefined ? {} : { disabled })}
      {...(visibleError === undefined ? {} : { error: visibleError })}
      onBlur={() => {
        setTouched(true);
      }}
      onChange={(event) => {
        const nextDisplayValue = maskSurveyLocalDate(event.currentTarget.value);
        const parsed = parseSurveyLocalDate(nextDisplayValue);
        const nextValue =
          parsed === "" ? undefined : (parsed ?? invalidSurveyDate);
        setDisplayValue(nextDisplayValue);
        lastEmittedValue.current = nextValue;
        onChange(nextValue);
      }}
    />
  );
}
