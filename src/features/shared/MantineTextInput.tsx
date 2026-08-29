import {
  useId,
  type ChangeEventHandler,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type ReactNode,
  type Ref,
} from "react";
import classes from "./MantineTextInput.module.css";

interface MantineTextInputProps {
  "aria-label"?: string;
  autoCapitalize?: string;
  autoComplete?: string;
  classNames?: { input?: string | undefined };
  component?: "textarea" | undefined;
  defaultValue?: string;
  description?: string;
  disabled?: boolean;
  error?: string | undefined;
  flex?: number;
  inputMode?:
    "decimal" | "email" | "numeric" | "search" | "tel" | "text" | "url";
  label?: string;
  list?: string;
  inputRef?: Ref<HTMLInputElement | HTMLTextAreaElement>;
  max?: number | undefined;
  maxLength?: number;
  minLength?: number;
  min?: number | undefined;
  name?: string;
  onBlur?: FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  onChange?: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  pattern?: string;
  placeholder?: string;
  readOnly?: boolean;
  required?: boolean;
  spellCheck?: boolean;
  step?: string;
  type?: "date" | "datetime-local" | "email" | "number" | "password" | "text";
  value?: string;
  withAsterisk?: boolean;
  children?: ReactNode;
}

export function MantineTextInput({
  "aria-label": ariaLabel,
  children,
  classNames,
  component,
  description,
  error,
  flex,
  inputRef,
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
        <textarea
          {...common}
          ref={inputRef as Ref<HTMLTextAreaElement> | undefined}
        />
      ) : (
        <input
          {...common}
          ref={inputRef as Ref<HTMLInputElement> | undefined}
        />
      )}
      {children}
      {error ? (
        <span className={classes.error} id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
