import { z } from "#/validation/zod";
import { isIanaTimeZone } from "#/features/shared/iana-timezone";

declare const instantIsoBrand: unique symbol;
declare const localDateBrand: unique symbol;
declare const localDateTimeBrand: unique symbol;
declare const ianaTimeZoneBrand: unique symbol;
declare const isoDurationBrand: unique symbol;

export type InstantIso = string & { readonly [instantIsoBrand]: true };
export type LocalDateIso = string & { readonly [localDateBrand]: true };
export type LocalDateTimeIso = string & {
  readonly [localDateTimeBrand]: true;
};
export type IanaTimeZone = string & { readonly [ianaTimeZoneBrand]: true };
export type IsoDuration = string & { readonly [isoDurationBrand]: true };
export type EventReleaseOffsetUnit =
  "minute" | "hour" | "day" | "week" | "month";

export const instantIsoSchema = z.pipe(
  z.iso
    .datetime({ offset: true })
    .check(z.regex(/Z$/u, "Use a canonical UTC instant.")),
  z.transform((value: string) => value as InstantIso),
);

export const localDateIsoSchema = z.pipe(
  z.iso.date(),
  z.transform((value: string) => value as LocalDateIso),
);

export const localDateTimeIsoSchema = z.pipe(
  z
    .string()
    .check(
      z.regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u,
        "Use a local date and time without a timezone.",
      ),
    ),
  z.transform((value: string) => value as LocalDateTimeIso),
);

export const ianaTimeZoneSchema = z.pipe(
  z
    .string()
    .check(
      z.trim(),
      z.minLength(1, "Select a timezone."),
      z.maxLength(100),
      z.refine(isIanaTimeZone, "Select a supported timezone."),
    ),
  z.transform((value: string) => value as IanaTimeZone),
);

export const isoDurationSchema = z.pipe(
  z
    .string()
    .check(
      z.regex(
        /^-?P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/u,
        "Use an ISO 8601 duration.",
      ),
    ),
  z.transform((value: string) => value as IsoDuration),
);
