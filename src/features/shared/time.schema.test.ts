import { describe, expect, it } from "vitest";
import {
  ianaTimeZoneSchema,
  instantIsoSchema,
  isoDurationSchema,
  localDateIsoSchema,
  localDateTimeIsoSchema,
} from "./time.schema";

describe("time schemas", () => {
  it("distinguishes exact instants from local wall-clock values", () => {
    expect(instantIsoSchema.safeParse("2027-08-20T23:00:00.000Z").success).toBe(
      true,
    );
    expect(instantIsoSchema.safeParse("2027-08-21T09:00:00").success).toBe(
      false,
    );
    expect(localDateTimeIsoSchema.safeParse("2027-08-21T09:00").success).toBe(
      true,
    );
    expect(
      localDateTimeIsoSchema.safeParse("2027-08-20T23:00:00Z").success,
    ).toBe(false);
  });

  it("validates dates, IANA timezones and explicit durations", () => {
    expect(localDateIsoSchema.safeParse("2028-02-29").success).toBe(true);
    expect(localDateIsoSchema.safeParse("2027-02-29").success).toBe(false);
    expect(ianaTimeZoneSchema.safeParse("Australia/Sydney").success).toBe(true);
    expect(ianaTimeZoneSchema.safeParse("Sydney").success).toBe(false);
    expect(isoDurationSchema.safeParse("P1M").success).toBe(true);
    expect(isoDurationSchema.safeParse("PT24H").success).toBe(true);
    expect(isoDurationSchema.safeParse("30 days").success).toBe(false);
  });
});
