const localDateTimePattern = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/u;
const localIsoPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/u;

function isValidParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): boolean {
  if (hour > 23 || minute > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function formatEventLocalDateTime(value: string): string {
  const match = localIsoPattern.exec(value);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  if (!year || !month || !day || !hour || !minute) return "";
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

export function parseEventLocalDateTime(value: string): string | null {
  if (!value.trim()) return "";
  const match = localDateTimePattern.exec(value.trim());
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  if (!year || !month || !day || !hour || !minute) return null;
  if (
    !isValidParts(
      Number(year),
      Number(month),
      Number(day),
      Number(hour),
      Number(minute),
    )
  )
    return null;
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function maskEventLocalDateTime(value: string): string {
  const digits = value.replaceAll(/\D/gu, "").slice(0, 12);
  const parts = [
    digits.slice(0, 2),
    digits.slice(2, 4),
    digits.slice(4, 8),
  ].filter(Boolean);
  const date = parts.join("/");
  const hour = digits.slice(8, 10);
  const minute = digits.slice(10, 12);
  if (!hour) return date;
  return `${date} ${hour}${minute ? `:${minute}` : ""}`;
}
