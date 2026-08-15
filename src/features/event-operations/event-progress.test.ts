import { describe, expect, it } from "vitest";
import { filterEventParticipantProgress } from "./event-progress";
import type { EventParticipantProgress } from "./event-operations.schema";

const participants: Array<EventParticipantProgress> = [
  {
    eventParticipationId: "participation-one",
    name: "Alex Learner",
    email: "alex@example.com",
    regionId: "region-one",
    regionName: "Northern Region",
    state: "completed",
    completedAt: "2026-08-15T00:00:00.000Z",
    completedAvailableItems: 2,
    availableItems: 2,
    totalItems: 2,
    sections: [],
  },
  {
    eventParticipationId: "participation-two",
    name: "Jordan Learner",
    email: "jordan@example.com",
    regionId: "region-two",
    regionName: "Southern Region",
    state: "in_progress",
    completedAt: null,
    completedAvailableItems: 1,
    availableItems: 2,
    totalItems: 3,
    sections: [],
  },
];

describe("filterEventParticipantProgress", () => {
  it("combines state and case-insensitive participant scope filters", () => {
    expect(
      filterEventParticipantProgress(participants, {
        q: "NORTHERN",
        state: "completed",
      }).map((participant) => participant.eventParticipationId),
    ).toEqual(["participation-one"]);
    expect(
      filterEventParticipantProgress(participants, {
        q: "jordan@example.com",
        state: "completed",
      }),
    ).toEqual([]);
  });
});
