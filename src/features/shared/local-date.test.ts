import { describe, expect, it } from "vitest";
import { formatLocalDate } from "./local-date";

describe("formatLocalDate", () => {
  it("formats instants in the requested timezone", () => {
    const instant = "2026-08-30T15:30:00.000Z";

    expect(formatLocalDate(instant, { timeZone: "UTC" })).toBe("30 Aug 2026");
    expect(formatLocalDate(instant, { timeZone: "Australia/Sydney" })).toBe(
      "31 Aug 2026",
    );
  });

  it("keeps date-only values stable across timezones", () => {
    expect(
      formatLocalDate("2026-08-30", { timeZone: "America/Los_Angeles" }),
    ).toBe("30 Aug 2026");
  });
});
