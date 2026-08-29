type LocalDateValue = string | number | Date;

const localDateFormatter = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
});
const dateOnlyFormatter = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeZone: "UTC",
});
const localDateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatLocalDate(value: LocalDateValue): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value))
    return dateOnlyFormatter.format(new Date(`${value}T00:00:00.000Z`));
  return localDateFormatter.format(new Date(value));
}

export function formatLocalDateTime(
  value: LocalDateValue,
  options: { timeZone?: string } = {},
): string {
  const key = options.timeZone ?? "local";
  let formatter = localDateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-AU", {
      dateStyle: "medium",
      timeStyle: "short",
      ...options,
    });
    localDateTimeFormatters.set(key, formatter);
  }
  return formatter.format(new Date(value));
}
