type LocalDateValue = string | number | Date;

const dateOnlyFormatter = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeZone: "UTC",
});
const localDateFormatters = new Map<string, Intl.DateTimeFormat>();
const localDateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatLocalDate(
  value: LocalDateValue,
  options: { timeZone?: string } = {},
): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value))
    return dateOnlyFormatter.format(new Date(`${value}T00:00:00.000Z`));
  const key = options.timeZone ?? "local";
  let formatter = localDateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-AU", {
      dateStyle: "medium",
      ...options,
    });
    localDateFormatters.set(key, formatter);
  }
  return formatter.format(new Date(value));
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
