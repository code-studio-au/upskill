type LocalDateValue = string | number | Date;

const localDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});
const localDateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatLocalDate(value: LocalDateValue): string {
  return localDateFormatter.format(new Date(value));
}

export function formatLocalDateTime(
  value: LocalDateValue,
  options: { timeZone?: string } = {},
): string {
  const key = options.timeZone ?? "local";
  let formatter = localDateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      ...options,
    });
    localDateTimeFormatters.set(key, formatter);
  }
  return formatter.format(new Date(value));
}

export function formatDateTimeLocalInput(
  value: LocalDateValue,
  timeZone: string,
): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(value))
      .map(({ type, value: partValue }) => [type, partValue]),
  );
  const { year, month, day, hour, minute } = parts;
  if (!year || !month || !day || !hour || !minute)
    throw new RangeError("The date could not be represented in this timezone.");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}
