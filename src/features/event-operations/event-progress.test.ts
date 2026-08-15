import { describe, expect, it } from "vitest";
import { filterEventParticipantProgress } from "./event-progress";
import { indexEventAttendanceByParticipant } from "./participant-attendance";
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

describe("indexEventAttendanceByParticipant", () => {
  it("indexes scoped session records by participant", () => {
    const attendanceByParticipant = indexEventAttendanceByParticipant([
      {
        id: "session-one",
        title: "Workshop day one",
        startsAt: "2026-08-15T00:00:00.000Z",
        endsAt: "2026-08-15T06:00:00.000Z",
        canRecordAttendance: true,
        attendance: [
          {
            eventParticipationId: "participation-one",
            name: "Alex Learner",
            email: "alex@example.com",
            state: "attended",
          },
          {
            eventParticipationId: "participation-two",
            name: "Jordan Learner",
            email: "jordan@example.com",
            state: "absent",
          },
        ],
      },
      {
        id: "session-two",
        title: "Workshop day two",
        startsAt: "2026-08-16T00:00:00.000Z",
        endsAt: "2026-08-16T06:00:00.000Z",
        canRecordAttendance: true,
        attendance: [
          {
            eventParticipationId: "participation-one",
            name: "Alex Learner",
            email: "alex@example.com",
            state: "checked_in",
          },
          {
            eventParticipationId: "participation-two",
            name: "Jordan Learner",
            email: "jordan@example.com",
            state: "not_recorded",
          },
        ],
      },
    ]);

    expect(attendanceByParticipant.get("participation-one")).toEqual([
      {
        sessionId: "session-one",
        sessionTitle: "Workshop day one",
        state: "attended",
      },
      {
        sessionId: "session-two",
        sessionTitle: "Workshop day two",
        state: "checked_in",
      },
    ]);
  });
});
