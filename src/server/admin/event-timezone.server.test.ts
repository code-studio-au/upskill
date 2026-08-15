import { describe, expect, it } from "vitest";
import {
  convertAdminEventOccurrenceForm,
  isAdminEventScheduleConsistent,
  wallClockDateTimeToIso,
} from "./event-timezone.server";

describe("Event timezone conversion", () => {
  it("interprets wall-clock values in the selected timezone", () => {
    expect(wallClockDateTimeToIso("2027-08-21T09:00", "Australia/Sydney")).toBe(
      "2027-08-20T23:00:00.000Z",
    );
    expect(wallClockDateTimeToIso("2027-08-21T09:00", "America/New_York")).toBe(
      "2027-08-21T13:00:00.000Z",
    );
  });

  it("rejects invalid timezones and nonexistent daylight-saving times", () => {
    expect(wallClockDateTimeToIso("2027-08-21T09:00", "Not/AZone")).toBeNull();
    expect(
      wallClockDateTimeToIso("2027-99-99T09:00", "Australia/Sydney"),
    ).toBeNull();
    expect(
      wallClockDateTimeToIso("2027-03-14T02:30", "America/New_York"),
    ).toBeNull();
  });

  it("converts and validates a complete occurrence form", () => {
    const converted = convertAdminEventOccurrenceForm({
      eventTemplateVersionId: "event_template_version_1",
      slug: "sydney-workshop",
      title: "Statewide workshop",
      deliveryMode: "virtual",
      registrationMode: "open_entry",
      approvalMode: "automatic",
      timezone: "Australia/Sydney",
      startsAt: "2027-08-21T09:00",
      endsAt: "2027-08-21T10:00",
      registrationOpensAt: "",
      registrationClosesAt: "",
      coordinatorLockAt: "",
      capacity: 80,
      venueName: "",
      venueAddress: "",
      virtualJoinUrl: "https://meet.example.com/workshop",
      domains: "",
    });
    expect(converted).toMatchObject({
      localStartsAt: "2027-08-21T09:00:00",
      localEndsAt: "2027-08-21T10:00:00",
      startsAt: "2027-08-20T23:00:00.000Z",
      endsAt: "2027-08-21T00:00:00.000Z",
    });
    expect(converted && isAdminEventScheduleConsistent(converted)).toBe(true);
  });

  it("rejects a stale instant after an event-local schedule change", () => {
    const converted = convertAdminEventOccurrenceForm({
      eventTemplateVersionId: "event_template_version_1",
      slug: "sydney-workshop",
      title: "Statewide workshop",
      deliveryMode: "virtual",
      registrationMode: "open_entry",
      approvalMode: "automatic",
      timezone: "Australia/Sydney",
      startsAt: "2027-08-21T09:00",
      endsAt: "2027-08-21T10:00",
      registrationOpensAt: "",
      registrationClosesAt: "",
      coordinatorLockAt: "",
      capacity: 80,
      venueName: "",
      venueAddress: "",
      virtualJoinUrl: "https://meet.example.com/workshop",
      domains: "",
    });
    expect(converted).not.toBeNull();
    expect(
      converted &&
        isAdminEventScheduleConsistent({
          ...converted,
          localStartsAt: "2027-08-21T10:00:00",
        }),
    ).toBe(false);
  });
});
