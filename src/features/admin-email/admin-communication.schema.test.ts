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
    expect(eventCommunicationAudiencesForTrigger("event_completed")).toEqual([
      { value: "affected_learner", label: "Affected learner" },
    ]);
    expect(eventCommunicationAudiencesForTrigger("section_release")).toEqual([
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

  it("retains operational audiences for occurrence-level triggers", () => {
    expect(
      eventCommunicationAudiencesForTrigger("event_end").map(
        (audience) => audience.value,
      ),
    ).toContain("administrators");
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
      normalizeEventCommunicationAudience("event_end", "administrators"),
    ).toBe("administrators");
  });
});
