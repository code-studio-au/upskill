import { useId, useState, type FocusEventHandler } from "react";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import {
  resolveEventTimezoneInput,
  type EventTimezoneOption,
} from "./event-timezones";

export function EventTimezoneAutocomplete({
  options,
  value,
  error,
  onBlur,
  onChange,
}: {
  options: Array<EventTimezoneOption>;
  value: string;
  error?: string | undefined;
  onBlur?:
    FocusEventHandler<HTMLInputElement | HTMLTextAreaElement> | undefined;
  onChange: (timezone: string) => void;
}) {
  const suggestionsId = useId();
  const [query, setQuery] = useState(
    () => options.find((option) => option.value === value)?.label ?? value,
  );

  return (
    <>
      <MantineTextInput
        label="Event timezone"
        placeholder="Search for Sydney, London, New York…"
        list={suggestionsId}
        value={query}
        {...(onBlur ? { onBlur } : {})}
        onChange={(event) => {
          const nextQuery = event.currentTarget.value;
          setQuery(nextQuery);
          onChange(resolveEventTimezoneInput(nextQuery, options));
        }}
        {...(error ? { error } : {})}
        autoComplete="off"
        spellCheck={false}
        required
      />
      <datalist id={suggestionsId}>
        {options.map((option) => (
          <option value={option.label} key={option.value} />
        ))}
      </datalist>
    </>
  );
}
