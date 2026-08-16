import { useEffect, useId, useRef, useState } from "react";
import {
  formatEventLocalDateTime,
  maskEventLocalDateTime,
  parseEventLocalDateTime,
} from "./event-local-date-time";
import classes from "./EventLocalDateTimeInput.module.css";

const invalidLocalDateTimeValue = "invalid-local-date-time";

export function EventLocalDateTimeInput({
  disabled,
  error,
  label,
  required,
  value,
  onBlur,
  onChange,
}: {
  disabled?: boolean;
  error?: string | undefined;
  label: string;
  required?: boolean;
  value: string;
  onBlur?: (() => void) | undefined;
  onChange: (value: string) => void;
}) {
  const inputId = useId();
  const errorId = useId();
  const nativePicker = useRef<HTMLInputElement>(null);
  const lastEmittedValue = useRef<string | null>(null);
  const [displayValue, setDisplayValue] = useState(() =>
    formatEventLocalDateTime(value),
  );
  const [touched, setTouched] = useState(false);
  const parsedValue = parseEventLocalDateTime(displayValue);
  const visibleError =
    touched && parsedValue === null ? "Use DD/MM/YYYY HH:mm." : error;

  useEffect(() => {
    if (lastEmittedValue.current === value) {
      lastEmittedValue.current = null;
      return;
    }
    setDisplayValue(formatEventLocalDateTime(value));
  }, [value]);

  function emit(nextDisplayValue: string): void {
    const parsed = parseEventLocalDateTime(nextDisplayValue);
    const nextValue = parsed ?? invalidLocalDateTimeValue;
    lastEmittedValue.current = nextValue;
    onChange(nextValue);
  }

  function openPicker(): void {
    const picker = nativePicker.current;
    if (!picker) return;
    try {
      picker.showPicker();
    } catch {
      picker.click();
    }
  }

  return (
    <div className={classes.root}>
      <label className={classes.label} htmlFor={inputId}>
        {label}
        {required ? " *" : ""}
      </label>
      <div className={classes.control}>
        <input
          id={inputId}
          className={classes.input}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD/MM/YYYY HH:mm"
          maxLength={16}
          value={displayValue}
          disabled={disabled}
          required={required}
          aria-invalid={Boolean(visibleError)}
          aria-describedby={visibleError ? errorId : undefined}
          onBlur={() => {
            setTouched(true);
            onBlur?.();
          }}
          onChange={(event) => {
            const nextDisplayValue = maskEventLocalDateTime(
              event.currentTarget.value,
            );
            setDisplayValue(nextDisplayValue);
            emit(nextDisplayValue);
          }}
        />
        <button
          type="button"
          className={classes.pickerButton}
          aria-label={`Choose ${label.toLocaleLowerCase("en-AU")}`}
          disabled={disabled}
          onClick={openPicker}
        >
          <span aria-hidden="true">▦</span>
        </button>
        <input
          ref={nativePicker}
          className={classes.nativePicker}
          type="datetime-local"
          tabIndex={-1}
          aria-hidden="true"
          value={parsedValue ?? ""}
          disabled={disabled}
          onChange={(event) => {
            const nextValue = event.currentTarget.value;
            const nextDisplayValue = formatEventLocalDateTime(nextValue);
            setDisplayValue(nextDisplayValue);
            setTouched(true);
            lastEmittedValue.current = nextValue;
            onChange(nextValue);
          }}
        />
      </div>
      {visibleError ? (
        <span className={classes.error} id={errorId}>
          {visibleError}
        </span>
      ) : null}
    </div>
  );
}
