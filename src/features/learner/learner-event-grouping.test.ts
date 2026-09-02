import { describe, expect, it } from "vitest";
import type { LearnerEvent } from "./learner.schema";
import { groupLearnerEvents } from "./learner-event-grouping";

function event(
  eventOccurrenceId: string,
  registrationStatus: LearnerEvent["registrationStatus"],
  registrationUnavailableReason: LearnerEvent["registrationUnavailableReason"] = null,
  participationMode: LearnerEvent["participationMode"] = null,
  completedAt: string | null = null,
): LearnerEvent {
  return {
    eventOccurrenceId,
    slug: eventOccurrenceId,
    title: eventOccurrenceId,
    eventTemplateTitle: "Test Event Template",
    eventTemplateVersion: 1,
    deliveryMode: "virtual",
    timezone: "Australia/Sydney",
    startsAt: "2026-08-20T09:00:00.000Z",
    endsAt: "2026-08-20T12:00:00.000Z",
    registrationStatus,
    participationMode,
    completedAt,
    certificate: null,
    registrationRequired: false,
    canRegister:
      registrationStatus === null && registrationUnavailableReason === null,
    registrationUnavailableReason,
    regions: [],
    progress: null,
  };
}

describe("groupLearnerEvents", () => {
  it("separates active registrations, historical outcomes and eligible event listings without reordering", () => {
    const grouped = groupLearnerEvents([
      event("submitted", "submitted"),
      event("declined", "coordinator_declined"),
      event("available", null),
      event("closed", null, "closed"),
      event("opens-later", null, "not_open"),
      event("approved", "coordinator_approved"),
      event("withdrawn", "withdrawn", "closed"),
      event("selected", "selected"),
      event("not-selected", "not_selected"),
      event("waitlisted", "waitlisted"),
      event("cancelled", "cancelled", "closed"),
      event("open-entry", null, "closed", "open_entry"),
      event(
        "completed-selected",
        "selected",
        "closed",
        null,
        "2026-08-20T12:30:00.000Z",
      ),
      event(
        "completed-open-entry",
        null,
        "closed",
        "open_entry",
        "2026-08-20T12:30:00.000Z",
      ),
    ]);

    expect(grouped.registrations.map((item) => item.eventOccurrenceId)).toEqual(
      ["submitted", "approved", "selected", "waitlisted", "open-entry"],
    );
    expect(grouped.history.map((item) => item.eventOccurrenceId)).toEqual([
      "declined",
      "withdrawn",
      "not-selected",
      "cancelled",
      "completed-selected",
      "completed-open-entry",
    ]);
    expect(grouped.available.map((item) => item.eventOccurrenceId)).toEqual([
      "available",
      "opens-later",
    ]);
    expect(Object.values(grouped).flat()).not.toContainEqual(
      expect.objectContaining({ eventOccurrenceId: "closed" }),
    );
  });
});
