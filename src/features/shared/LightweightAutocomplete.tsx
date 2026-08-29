import {
  useId,
  useState,
  type FocusEventHandler,
  type KeyboardEvent,
} from "react";
import {
  filterAutocompleteOptions,
  type LightweightAutocompleteOption,
} from "./lightweight-autocomplete-options";
import classes from "./LightweightAutocomplete.module.css";

export function LightweightAutocomplete({
  label,
  description,
  placeholder,
  value,
  options,
  error,
  disabled = false,
  loading = false,
  limit = 10,
  maxLength,
  type = "email",
  className,
  onBlur,
  onChange,
  onSelect,
}: {
  label: string;
  description?: string | undefined;
  placeholder?: string | undefined;
  value: string;
  options: ReadonlyArray<LightweightAutocompleteOption>;
  error?: string | undefined;
  disabled?: boolean;
  loading?: boolean;
  limit?: number;
  maxLength?: number | undefined;
  type?: "email" | "search" | "text";
  className?: string | undefined;
  onBlur?: FocusEventHandler<HTMLInputElement> | undefined;
  onChange: (value: string) => void;
  onSelect?: ((option: LightweightAutocompleteOption) => void) | undefined;
}) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = filterAutocompleteOptions(options, value, limit);

  function select(option: LightweightAutocompleteOption) {
    onChange(option.value);
    onSelect?.(option);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!matches.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      const option = matches[activeIndex];
      if (option) select(option);
    }
  }

  return (
    <div className={`${classes.root ?? ""} ${className ?? ""}`}>
      <label className={classes.label} htmlFor={id}>
        {label}
      </label>
      {description ? (
        <span className={classes.description} id={descriptionId}>
          {description}
        </span>
      ) : null}
      <div className={classes.control}>
        <input
          id={id}
          className={classes.input}
          type={type}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open && matches.length > 0}
          aria-activedescendant={
            open && matches[activeIndex]
              ? `${listboxId}-option-${String(activeIndex)}`
              : undefined
          }
          aria-describedby={
            [description ? descriptionId : null, error ? errorId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
          aria-invalid={Boolean(error)}
          autoComplete="off"
          disabled={disabled}
          maxLength={maxLength}
          placeholder={placeholder}
          value={value}
          onBlur={(event) => {
            setOpen(false);
            onBlur?.(event);
          }}
          onChange={(event) => {
            onChange(event.currentTarget.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        {loading ? (
          <span
            className={classes.loader}
            role="status"
            aria-label="Searching"
          />
        ) : null}
        {open && matches.length ? (
          <ul className={classes.options} id={listboxId} role="listbox">
            {matches.map((option, index) => (
              <li key={option.value} role="none">
                <button
                  id={`${listboxId}-option-${String(index)}`}
                  className={classes.option}
                  data-active={index === activeIndex || undefined}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onMouseEnter={() => {
                    setActiveIndex(index);
                  }}
                  onClick={() => {
                    select(option);
                  }}
                >
                  <span className={classes.optionLabel}>{option.label}</span>
                  {option.description ? (
                    <span className={classes.optionDescription}>
                      {option.description}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {error ? (
        <span className={classes.error} id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
