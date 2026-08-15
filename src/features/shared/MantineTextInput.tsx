import { useId, type ChangeEventHandler, type FocusEventHandler } from "react";
import classes from "./MantineTextInput.module.css";

interface MantineTextInputProps {
  "aria-label"?: string;
  autoCapitalize?: string;
  autoComplete?: string;
  classNames?: { input?: string | undefined };
  component?: "textarea";
  defaultValue?: string;
  description?: string;
  disabled?: boolean;
  error?: string | undefined;
  flex?: number;
  inputMode?:
    "decimal" | "email" | "numeric" | "search" | "tel" | "text" | "url";
  label?: string;
  list?: string;
  max?: number;
  maxLength?: number;
  min?: number;
  name?: string;
  onBlur?: FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  onChange?: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  placeholder?: string;
  required?: boolean;
  spellCheck?: boolean;
  step?: string;
  type?: "date" | "datetime-local" | "email" | "number" | "password" | "text";
  value?: string;
  withAsterisk?: boolean;
}

export function MantineTextInput({
  "aria-label": ariaLabel,
  classNames,
  component,
  description,
  error,
  flex,
  label,
  required,
  withAsterisk,
  ...input
}: MantineTextInputProps) {
  const id = useId();
  const descriptionId = useId();
  const errorId = useId();
  const describedBy = [
    description ? descriptionId : null,
    error ? errorId : null,
  ]
    .filter(Boolean)
    .join(" ");
  const inputClassName = `${classes.input ?? ""} ${
    component === "textarea" ? (classes.textarea ?? "") : ""
  } ${classNames?.input ?? ""}`;
  const common = {
    ...input,
    id,
    className: inputClassName,
    "aria-label": ariaLabel,
    "aria-invalid": Boolean(error),
    "aria-describedby": describedBy || undefined,
    "aria-required": required || withAsterisk || undefined,
    required,
  };

  return (
    <div className={classes.root} data-grow={flex === 1 || undefined}>
      {label ? (
        <label className={classes.label} htmlFor={id}>
          {label}
          {required || withAsterisk ? " *" : ""}
        </label>
      ) : null}
      {description ? (
        <span className={classes.description} id={descriptionId}>
          {description}
        </span>
      ) : null}
      {component === "textarea" ? (
        <textarea {...common} />
      ) : (
        <input {...common} />
      )}
      {error ? (
        <span className={classes.error} id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
