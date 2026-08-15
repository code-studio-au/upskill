export interface EventTimezoneOption {
  label: string;
  value: string;
}

const eventTimezoneCollator = new Intl.Collator("en-AU");

function readableTimezone(timezone: string): string {
  if (timezone === "UTC") return "UTC";
  const [region, ...location] = timezone.split("/");
  if (!region || location.length === 0) return timezone.replaceAll("_", " ");
  return `${location.join(" / ").replaceAll("_", " ")} — ${region.replaceAll("_", " ")}`;
}

export function createEventTimezoneOptions(
  selectedTimezone?: string,
): Array<EventTimezoneOption> {
  const timezones = new Set(["UTC", ...Intl.supportedValuesOf("timeZone")]);
  if (selectedTimezone) timezones.add(selectedTimezone);
  return [...timezones]
    .map((value) => ({ value, label: readableTimezone(value) }))
    .sort((left, right) =>
      eventTimezoneCollator.compare(left.label, right.label),
    );
}

export function resolveEventTimezoneInput(
  input: string,
  options: Array<EventTimezoneOption>,
): string {
  const normalizedInput = input.trim().toLocaleLowerCase("en-AU");
  return (
    options.find(
      (option) =>
        option.label.toLocaleLowerCase("en-AU") === normalizedInput ||
        option.value.toLocaleLowerCase("en-AU") === normalizedInput,
    )?.value ?? input
  );
}
