import { useId, type ChangeEventHandler, type FocusEventHandler } from "react";
import classes from "./MantineNativeSelect.module.css";

interface SelectOption {
  disabled?: boolean;
  label: string;
  value: string;
}

interface MantineNativeSelectProps {
  "aria-label"?: string;
  data: Array<SelectOption>;
  defaultValue?: string;
  disabled?: boolean;
  error?: string | undefined;
  label?: string;
  name?: string;
  onBlur?: FocusEventHandler<HTMLSelectElement>;
  onChange?: ChangeEventHandler<HTMLSelectElement>;
  required?: boolean;
  value?: string;
}

export function MantineNativeSelect({
  "aria-label": ariaLabel,
  data,
  error,
  label,
  required,
  ...input
}: MantineNativeSelectProps) {
  const id = useId();
  const errorId = useId();
  return (
    <div className={classes.root}>
      {label ? (
        <label className={classes.label} htmlFor={id}>
          {label}
          {required ? " *" : ""}
        </label>
      ) : null}
      <select
        {...input}
        id={id}
        className={classes.select}
        aria-label={ariaLabel}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        required={required}
      >
        {data.map((option) => (
          <option
            value={option.value}
            disabled={option.disabled}
            key={option.value}
          >
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className={classes.error} id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
