import "@tanstack/react-start/server-only";

import {
  adminEventOccurrenceCreateSchema,
  type AdminEventOccurrenceCreateInput,
  type AdminEventOccurrenceFormInput,
} from "#/features/admin-event/admin-event.schema";
import {
  ianaTimeZoneSchema,
  localDateTimeIsoSchema,
} from "#/features/shared/time.schema";
import { resolveZonedDateTime } from "#/server/time/time.server";

export function wallClockDateTimeToIso(
  value: string,
  timezone: string,
): string | null {
  const normalized = value.length === 16 ? `${value}:00` : value;
  const parsedLocal = localDateTimeIsoSchema.safeParse(normalized);
  const parsedTimezone = ianaTimeZoneSchema.safeParse(timezone);
  if (!parsedLocal.success || !parsedTimezone.success) return null;
  return (
    resolveZonedDateTime(parsedLocal.data, parsedTimezone.data, "reject")
      ?.instant ?? null
  );
}

export function convertAdminEventOccurrenceForm(
  input: AdminEventOccurrenceFormInput,
): AdminEventOccurrenceCreateInput | null {
  const parsedTimezone = ianaTimeZoneSchema.safeParse(input.timezone);
  if (!parsedTimezone.success) return null;
  const convert = (value: string) => {
    if (!value) return { instant: "", localDateTime: "" } as const;
    const normalized = value.length === 16 ? `${value}:00` : value;
    const parsedLocal = localDateTimeIsoSchema.safeParse(normalized);
    if (!parsedLocal.success) return null;
    return resolveZonedDateTime(
      parsedLocal.data,
      parsedTimezone.data,
      "reject",
    );
  };
  const startsAt = convert(input.startsAt);
  const endsAt = convert(input.endsAt);
  const registrationOpensAt = convert(input.registrationOpensAt);
  const registrationClosesAt = convert(input.registrationClosesAt);
  const coordinatorLockAt = convert(input.coordinatorLockAt);
  if (
    !startsAt ||
    !endsAt ||
    !registrationOpensAt ||
    !registrationClosesAt ||
    !coordinatorLockAt
  )
    return null;
  const candidate = {
    ...input,
    timezone: parsedTimezone.data,
    startsAt: startsAt.instant,
    localStartsAt: startsAt.localDateTime,
    endsAt: endsAt.instant,
    localEndsAt: endsAt.localDateTime,
    registrationOpensAt: registrationOpensAt.instant,
    localRegistrationOpensAt: registrationOpensAt.localDateTime,
    registrationClosesAt: registrationClosesAt.instant,
    localRegistrationClosesAt: registrationClosesAt.localDateTime,
    coordinatorLockAt: coordinatorLockAt.instant,
    localCoordinatorLockAt: coordinatorLockAt.localDateTime,
  };
  const parsed = adminEventOccurrenceCreateSchema.safeParse(candidate);
  return parsed.success
    ? {
        ...parsed.data,
        localStartsAt: startsAt.localDateTime,
        localEndsAt: endsAt.localDateTime,
        localRegistrationOpensAt: registrationOpensAt.localDateTime,
        localRegistrationClosesAt: registrationClosesAt.localDateTime,
        localCoordinatorLockAt: coordinatorLockAt.localDateTime,
      }
    : null;
}

export function isAdminEventScheduleConsistent(
  input: AdminEventOccurrenceCreateInput,
): boolean {
  const pairs = [
    [input.localStartsAt, input.startsAt],
    [input.localEndsAt, input.endsAt],
    [input.localRegistrationOpensAt, input.registrationOpensAt],
    [input.localRegistrationClosesAt, input.registrationClosesAt],
    [input.localCoordinatorLockAt, input.coordinatorLockAt],
  ] as const;
  return pairs.every(([localDateTime, instant]) => {
    if (!localDateTime || !instant) return !localDateTime && !instant;
    return wallClockDateTimeToIso(localDateTime, input.timezone) === instant;
  });
}
