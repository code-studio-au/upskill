import "@tanstack/react-start/server-only";

import {
  adminEventOccurrenceCreateSchema,
  type AdminEventOccurrenceCreateInput,
  type AdminEventOccurrenceFormInput,
} from "#/features/admin-event/admin-event.schema";

const formatterOptions: Intl.DateTimeFormatOptions = {
  calendar: "gregory",
  numberingSystem: "latn",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

function timezoneEpoch(instant: Date, timezone: string): number | null {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        ...formatterOptions,
        timeZone: timezone,
      })
        .formatToParts(instant)
        .map(({ type, value }) => [type, value]),
    );
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
  } catch {
    return null;
  }
}

export function wallClockDateTimeToIso(
  value: string,
  timezone: string,
): string | null {
  const normalized = value.length === 16 ? `${value}:00` : value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(normalized)) return null;
  const requested = new Date(`${normalized}Z`);
  if (
    Number.isNaN(requested.getTime()) ||
    requested.toISOString().slice(0, 19) !== normalized
  )
    return null;
  let instant = requested.getTime();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const represented = timezoneEpoch(new Date(instant), timezone);
    if (represented === null) return null;
    instant += requested.getTime() - represented;
  }
  return timezoneEpoch(new Date(instant), timezone) === requested.getTime()
    ? new Date(instant).toISOString()
    : null;
}

export function convertAdminEventOccurrenceForm(
  input: AdminEventOccurrenceFormInput,
): AdminEventOccurrenceCreateInput | null {
  const convert = (value: string) =>
    value ? wallClockDateTimeToIso(value, input.timezone) : "";
  const candidate = {
    ...input,
    startsAt: convert(input.startsAt),
    endsAt: convert(input.endsAt),
    registrationOpensAt: convert(input.registrationOpensAt),
    registrationClosesAt: convert(input.registrationClosesAt),
    coordinatorLockAt: convert(input.coordinatorLockAt),
  };
  if (Object.values(candidate).some((value) => value === null)) return null;
  const parsed = adminEventOccurrenceCreateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
