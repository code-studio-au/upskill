import { describe, expect, it } from "vitest";
import type { AdminEventAttendanceReviewRow } from "./admin-event-operations.schema";
import {
  filterAdminEventAttendanceRows,
  hasEstimatedAttendanceEvidence,
} from "./admin-event-attendance-report";

const automaticRow: AdminEventAttendanceReviewRow = {
  eventParticipationId: "participation-one",
  eventSessionId: "session-one",
  sessionTitle: "Clinical webinar",
  sessionStartsAt: "2030-09-04T00:00:00.000Z",
  sessionEndsAt: "2030-09-04T01:00:00.000Z",
  name: "Alex Learner",
  email: "alex@example.com",
  participationMode: "registered",
  state: "attended",
  source: "administrator",
  recordedByName: "Admin User",
  recordedAt: "2030-09-04T00:30:00.000Z",
  updatedAt: "2030-09-04T01:10:00.000Z",
  decisions: [
    {
      id: "decision-one",
      roomGeneration: 1,
      attendanceState: "attended",
      attendanceMode: "automatic_duration",
      attendanceMinimumMinutes: 30,
      qualifyingConnectedSeconds: 1_900,
      calculationVersion: 2,
      decisionAt: "2030-09-04T01:00:00.000Z",
      applicationOutcome: "applied",
      previousAttendanceState: "checked_in",
      previousAttendanceSource: "system",
    },
  ],
  intervals: [
    {
      id: "interval-one",
      roomGeneration: 1,
      joinedAt: "2030-09-04T00:00:00.000Z",
      leftAt: "2030-09-04T00:31:40.000Z",
      joinedSource: "webhook",
      leftSource: "provider_reconciliation",
    },
  ],
};

const noEvidenceRow: AdminEventAttendanceReviewRow = {
  ...automaticRow,
  eventParticipationId: "participation-two",
  eventSessionId: "session-two",
  sessionTitle: "Practical session",
  name: "Jordan Learner",
  email: "jordan@example.com",
  state: "not_recorded",
  source: null,
  recordedByName: null,
  recordedAt: null,
  updatedAt: null,
  decisions: [],
  intervals: [],
};

describe("filterAdminEventAttendanceRows", () => {
  it("combines URL-backed participant, session, state and evidence filters", () => {
    const rows = [automaticRow, noEvidenceRow];
    expect(
      filterAdminEventAttendanceRows(rows, {
        q: "ALEX",
        sessionId: "session-one",
        state: "attended",
        evidence: "automatic",
      }).map((row) => row.eventParticipationId),
    ).toEqual(["participation-one"]);
    expect(
      filterAdminEventAttendanceRows(rows, {
        q: "practical",
        sessionId: "all",
        state: "all",
        evidence: "none",
      }).map((row) => row.eventParticipationId),
    ).toEqual(["participation-two"]);
  });

  it("keeps staff corrections discoverable when automatic evidence also exists", () => {
    expect(
      filterAdminEventAttendanceRows([automaticRow], {
        q: "",
        sessionId: "all",
        state: "all",
        evidence: "staff",
      }),
    ).toEqual([automaticRow]);
    expect(hasEstimatedAttendanceEvidence(automaticRow)).toBe(true);
  });
});
