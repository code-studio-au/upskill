import { describe, expect, it } from "vitest";
import type { AdminEventAttendanceReport } from "#/features/admin-event/admin-event-operations.schema";
import { encodeAdminEventAttendanceCsv } from "./admin-event-attendance-csv";

const report: AdminEventAttendanceReport = {
  occurrence: {
    id: "occurrence-one",
    title: "Clinical webinar",
    timezone: "Australia/Sydney",
  },
  sessions: [
    {
      id: "session-one",
      title: "Clinical webinar",
      startsAt: "2030-09-04T00:00:00.000Z",
      endsAt: "2030-09-04T01:00:00.000Z",
    },
  ],
  rows: [
    {
      eventParticipationId: "participation-one",
      eventSessionId: "session-one",
      sessionTitle: "Clinical webinar",
      sessionStartsAt: "2030-09-04T00:00:00.000Z",
      sessionEndsAt: "2030-09-04T01:00:00.000Z",
      name: "=Formula Learner",
      email: "learner@example.com",
      participationMode: "registered",
      state: "attended",
      source: "system",
      recordedByName: null,
      recordedAt: "2030-09-04T00:10:00.000Z",
      updatedAt: "2030-09-04T00:30:00.000Z",
      estimatedEvidencePresent: true,
      decisions: [
        {
          id: "decision-one",
          roomGeneration: 1,
          attendanceState: "attended",
          attendanceMode: "automatic_duration",
          attendanceMinimumMinutes: 20,
          qualifyingConnectedSeconds: 1_800,
          calculationVersion: 2,
          decisionAt: "2030-09-04T00:30:00.000Z",
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
          leftAt: "2030-09-04T00:30:00.000Z",
          joinedSource: "webhook",
          leftSource: "room_end",
        },
      ],
    },
  ],
  evidenceTruncated: false,
  pagination: { page: 1, pages: 1, total: 1, pageSize: 25 },
};

describe("encodeAdminEventAttendanceCsv", () => {
  it("exports normalized summary, decision and interval evidence records", () => {
    const csv = encodeAdminEventAttendanceCsv(
      report,
      { q: "", sessionId: "all", state: "all", evidence: "all" },
      "2030-09-04T02:00:00.000Z",
    );
    expect(csv).toContain('"record_type"');
    expect(csv).toContain('"attendance"');
    expect(csv).toContain('"decision"');
    expect(csv).toContain('"interval"');
    expect(csv).toContain('"automatic_duration"');
    expect(csv).toContain('"room_end"');
    expect(csv).toContain("'=Formula Learner");
    expect(csv.trim().split("\r\n")).toHaveLength(4);
  });

  it("applies the same filters as the administrator review", () => {
    const csv = encodeAdminEventAttendanceCsv(
      report,
      {
        q: "missing",
        sessionId: "all",
        state: "all",
        evidence: "all",
      },
      "2030-09-04T02:00:00.000Z",
    );
    expect(csv.trim().split("\r\n")).toHaveLength(1);
  });

  it("can omit the header for subsequent streamed batches", () => {
    const csv = encodeAdminEventAttendanceCsv(
      report,
      { q: "", sessionId: "all", state: "all", evidence: "all" },
      "2030-09-04T02:00:00.000Z",
      { includeHeader: false },
    );
    expect(csv).not.toContain('"schema_version"');
    expect(csv).toContain('"attendance"');
  });
});
