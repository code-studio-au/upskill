import { describe, expect, it } from "vitest";
import { eventScheduleEmailItemSchema } from "./admin-communication.schema";
import {
  eventCommunicationAudiencesForTrigger,
  normalizeEventCommunicationAudience,
} from "./communication-options";

const baseItem = {
  id: "communication_1",
  kind: "automated_email" as const,
  title: "Completion email",
  emailDesignVersionId: "email_version_1",
  audience: "affected_learner" as const,
  trigger: "event_completed" as const,
  sessionItemId: null,
  offsetAmount: 0,
  offsetUnit: "minute" as const,
  subjectOverride: null,
  textBodyOverride: null,
};

describe("event communication trigger audiences", () => {
  it("limits participant-specific triggers to the affected learner", () => {
    for (const trigger of [
      "event_completed",
      "registration_cancelled",
      "registration_not_selected",
      "registration_selected",
      "registration_submitted",
      "registration_waitlisted",
      "section_release",
    ])
      expect(eventCommunicationAudiencesForTrigger(trigger)).toEqual([
        { value: "affected_learner", label: "Affected learner" },
      ]);
    expect(eventScheduleEmailItemSchema.safeParse(baseItem).success).toBe(true);
    expect(
      eventScheduleEmailItemSchema.safeParse({
        ...baseItem,
        audience: "confirmed_participants",
      }).success,
    ).toBe(false);
  });

  it("targets incomplete event-work reminders only to confirmed participants", () => {
    for (const trigger of [
      "prework_incomplete",
      "post_event_incomplete",
    ] as const) {
      expect(eventCommunicationAudiencesForTrigger(trigger)).toEqual([
        {
          value: "confirmed_participants",
          label: "Confirmed participants",
        },
      ]);
      expect(
        eventScheduleEmailItemSchema.safeParse({
          ...baseItem,
          trigger,
          audience: "confirmed_participants",
        }).success,
      ).toBe(true);
    }
  });

  it("offers operational audiences for event cancellation and rescheduling", () => {
    for (const trigger of ["event_cancelled", "event_rescheduled"]) {
      const audiences = eventCommunicationAudiencesForTrigger(trigger).map(
        (audience) => audience.value,
      );
      expect(audiences).toEqual([
        "active_registrants",
        "confirmed_participants",
        "presenters",
        "coordinators",
        "administrators",
      ]);
      expect(
        eventScheduleEmailItemSchema.safeParse({
          ...baseItem,
          trigger,
          audience: "administrators",
        }).success,
      ).toBe(true);
    }
  });

  it("retains operational audiences for occurrence-level triggers", () => {
    expect(
      eventCommunicationAudiencesForTrigger("event_end").map(
        (audience) => audience.value,
      ),
    ).toEqual([
      "affected_learner",
      "confirmed_participants",
      "presenters",
      "coordinators",
      "administrators",
    ]);
    expect(
      eventScheduleEmailItemSchema.safeParse({
        ...baseItem,
        trigger: "event_end",
        audience: "administrators",
      }).success,
    ).toBe(true);
  });

  it("compatibly normalizes retained participant-specific plans", () => {
    expect(
      normalizeEventCommunicationAudience(
        "event_completed",
        "confirmed_participants",
      ),
    ).toBe("affected_learner");
    expect(
      normalizeEventCommunicationAudience("section_release", "presenters"),
    ).toBe("affected_learner");
    expect(
      normalizeEventCommunicationAudience(
        "prework_incomplete",
        "administrators",
      ),
    ).toBe("confirmed_participants");
    expect(
      normalizeEventCommunicationAudience(
        "post_event_incomplete",
        "coordinators",
      ),
    ).toBe("confirmed_participants");
    expect(
      normalizeEventCommunicationAudience(
        "event_cancelled",
        "affected_learner",
      ),
    ).toBe("active_registrants");
    expect(
      normalizeEventCommunicationAudience("event_end", "administrators"),
    ).toBe("administrators");
    expect(
      normalizeEventCommunicationAudience("event_end", "active_registrants"),
    ).toBe("confirmed_participants");
  });
});
