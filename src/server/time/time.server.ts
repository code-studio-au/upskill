import "@tanstack/react-start/server-only";

import type {
  IanaTimeZone,
  InstantIso,
  IsoDuration,
  LocalDateIso,
  LocalDateTimeIso,
} from "#/features/shared/time.schema";

type Disambiguation = "compatible" | "earlier" | "later" | "reject";
type SmallestUnit = "millisecond" | "second";

interface NativePlainDateTime {
  toString(options?: { smallestUnit: SmallestUnit }): string;
  toZonedDateTime(
    timezone: string,
    options?: { disambiguation?: Disambiguation },
  ): NativeZonedDateTime;
}

interface NativeInstant {
  add(duration: NativeDurationLike): NativeInstant;
  epochMilliseconds: number;
  toString(options?: { smallestUnit: SmallestUnit }): string;
  toZonedDateTimeISO(timezone: string): NativeZonedDateTime;
}

interface NativeZonedDateTime {
  add(duration: NativeDurationLike): NativeZonedDateTime;
  offsetNanoseconds: number;
  toInstant(): NativeInstant;
  toPlainDateTime(): NativePlainDateTime;
}

interface NativeDurationLike {
  days?: number;
  hours?: number;
  milliseconds?: number;
  minutes?: number;
  months?: number;
  weeks?: number;
}

interface NativeTemporal {
  Duration: { from(value: string): NativeDurationLike };
  Instant: {
    from(value: string): NativeInstant;
  };
  PlainDateTime: { from(value: string): NativePlainDateTime };
}

function temporal(): NativeTemporal {
  const native = (
    globalThis as typeof globalThis & { Temporal?: NativeTemporal }
  ).Temporal;
  if (!native)
    throw new Error("Native Temporal requires the configured Node 26 runtime");
  return native;
}

function instantString(instant: NativeInstant): InstantIso {
  return instant.toString({ smallestUnit: "millisecond" }) as InstantIso;
}

function localDateTimeString(value: NativePlainDateTime): LocalDateTimeIso {
  return value.toString({ smallestUnit: "second" }) as LocalDateTimeIso;
}

export interface ResolvedZonedDateTime {
  instant: InstantIso;
  localDateTime: LocalDateTimeIso;
  offsetMinutes: number;
  timezone: IanaTimeZone;
}

export function resolveZonedDateTime(
  localDateTime: LocalDateTimeIso,
  timezone: IanaTimeZone,
  disambiguation: Disambiguation = "reject",
): ResolvedZonedDateTime | null {
  try {
    const zoned = temporal()
      .PlainDateTime.from(localDateTime)
      .toZonedDateTime(timezone, { disambiguation });
    return {
      instant: instantString(zoned.toInstant()),
      localDateTime: localDateTimeString(zoned.toPlainDateTime()),
      offsetMinutes: zoned.offsetNanoseconds / 60_000_000_000,
      timezone,
    };
  } catch {
    return null;
  }
}

export function instantToLocalDateTime(
  instant: InstantIso,
  timezone: IanaTimeZone,
): LocalDateTimeIso {
  return localDateTimeString(
    temporal()
      .Instant.from(instant)
      .toZonedDateTimeISO(timezone)
      .toPlainDateTime(),
  );
}

export function addZonedDuration(
  instant: InstantIso,
  timezone: IanaTimeZone,
  duration: IsoDuration,
): InstantIso {
  const zoned = temporal().Instant.from(instant).toZonedDateTimeISO(timezone);
  return instantString(
    zoned.add(temporal().Duration.from(duration)).toInstant(),
  );
}

export function addElapsedDuration(
  instant: InstantIso,
  duration: IsoDuration,
): InstantIso {
  return instantString(
    temporal().Instant.from(instant).add(temporal().Duration.from(duration)),
  );
}

export function dateToInstant(date: Date): InstantIso {
  return date.toISOString() as InstantIso;
}

export function instantToDate(instant: InstantIso): Date {
  return new Date(temporal().Instant.from(instant).epochMilliseconds);
}

export function addElapsedDays(date: Date, days: number): Date {
  return instantToDate(
    addElapsedDuration(
      dateToInstant(date),
      `PT${String(days * 24)}H` as IsoDuration,
    ),
  );
}

export function addElapsedMilliseconds(date: Date, milliseconds: number): Date {
  return instantToDate(
    instantString(
      temporal().Instant.from(dateToInstant(date)).add({ milliseconds }),
    ),
  );
}

export function utcEndOfDate(date: LocalDateIso): InstantIso {
  return `${date}T23:59:59.999Z` as InstantIso;
}

export function utcStartOfDate(date: LocalDateIso): InstantIso {
  return `${date}T00:00:00.000Z` as InstantIso;
}
