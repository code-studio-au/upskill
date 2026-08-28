import { describe, expect, it } from "vitest";
import type {
  IanaTimeZone,
  InstantIso,
  IsoDuration,
  LocalDateIso,
  LocalDateTimeIso,
} from "#/features/shared/time.schema";
import {
  addElapsedDuration,
  addElapsedDays,
  addZonedDuration,
  instantToLocalDateTime,
  resolveZonedDateTime,
  utcEndOfDate,
  utcStartOfDate,
} from "./time.server";

const local = (value: string) => value as LocalDateTimeIso;
const instant = (value: string) => value as InstantIso;
const timezone = (value: string) => value as IanaTimeZone;
const duration = (value: string) => value as IsoDuration;
const date = (value: string) => value as LocalDateIso;

describe("server time boundary", () => {
  it("resolves ordinary wall-clock values in their IANA timezone", () => {
    expect(
      resolveZonedDateTime(
        local("2027-08-21T09:00"),
        timezone("Australia/Sydney"),
      ),
    ).toEqual({
      instant: "2027-08-20T23:00:00.000Z",
      localDateTime: "2027-08-21T09:00:00",
      offsetMinutes: 600,
      timezone: "Australia/Sydney",
    });
  });

  it("rejects both skipped and repeated DST wall-clock times", () => {
    expect(
      resolveZonedDateTime(
        local("2027-03-14T02:30"),
        timezone("America/New_York"),
      ),
    ).toBeNull();
    expect(
      resolveZonedDateTime(
        local("2027-11-07T01:30"),
        timezone("America/New_York"),
      ),
    ).toBeNull();
    expect(
      resolveZonedDateTime(
        local("2027-04-04T01:45"),
        timezone("Australia/Lord_Howe"),
      ),
    ).toBeNull();
  });

  it("distinguishes a calendar day from 24 elapsed hours across DST", () => {
    const start = instant("2027-10-02T14:00:00.000Z");
    expect(
      addZonedDuration(start, timezone("Australia/Sydney"), duration("P1D")),
    ).toBe("2027-10-03T13:00:00.000Z");
    expect(addElapsedDuration(start, duration("PT24H"))).toBe(
      "2027-10-03T14:00:00.000Z",
    );
  });

  it("round-trips an instant through an event-local wall clock", () => {
    expect(
      instantToLocalDateTime(
        instant("2027-08-20T23:00:00.000Z"),
        timezone("Australia/Sydney"),
      ),
    ).toBe("2027-08-21T09:00:00");
  });

  it("makes enrollment days and UTC date expiry semantics explicit", () => {
    expect(addElapsedDays(new Date("2027-10-02T14:00:00.000Z"), 1)).toEqual(
      new Date("2027-10-03T14:00:00.000Z"),
    );
    expect(utcEndOfDate(date("2027-12-31"))).toBe("2027-12-31T23:59:59.999Z");
    expect(utcStartOfDate(date("2027-12-31"))).toBe("2027-12-31T00:00:00.000Z");
  });
});
