import { describe, expect, it } from "vitest";
import { calculateEventSectionReleaseAt } from "./event-section-release.server";

const anchor = new Date("2027-10-02T14:00:00.000Z");

describe("event section release calculations", () => {
  it("applies calendar-day offsets in the event timezone", () => {
    expect(
      calculateEventSectionReleaseAt({
        releaseAnchor: "occurrence_start",
        releaseOffsetAmount: 1,
        releaseOffsetUnit: "day",
        timezone: "Australia/Sydney",
        participationCreatedAt: anchor,
        occurrenceStartsAt: anchor,
        occurrenceEndsAt: anchor,
        finalSessionEndsAt: anchor,
      }).toISOString(),
    ).toBe("2027-10-03T13:00:00.000Z");
  });

  it("applies hour offsets as elapsed time", () => {
    expect(
      calculateEventSectionReleaseAt({
        releaseAnchor: "occurrence_start",
        releaseOffsetAmount: 24,
        releaseOffsetUnit: "hour",
        timezone: "Australia/Sydney",
        participationCreatedAt: anchor,
        occurrenceStartsAt: anchor,
        occurrenceEndsAt: anchor,
        finalSessionEndsAt: anchor,
      }).toISOString(),
    ).toBe("2027-10-03T14:00:00.000Z");
  });
});
