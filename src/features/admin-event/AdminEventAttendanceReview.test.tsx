import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdminEventAttendanceReport } from "./admin-event-operations.schema";
import { AdminEventAttendanceReview } from "./AdminEventAttendanceReview";

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
      name: "Alex Learner",
      email: "alex@example.com",
      participationMode: "registered",
      state: "attended",
      source: "administrator",
      recordedByName: "Admin User",
      recordedAt: "2030-09-04T00:10:00.000Z",
      updatedAt: "2030-09-04T00:30:00.000Z",
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
          applicationOutcome: "preserved_manual",
          previousAttendanceState: "absent",
          previousAttendanceSource: "administrator",
        },
      ],
      intervals: [
        {
          id: "interval-one",
          roomGeneration: 1,
          joinedAt: "2030-09-04T00:00:00.000Z",
          leftAt: "2030-09-04T00:30:00.000Z",
          joinedSource: "provider_reconciliation",
          leftSource: "room_end",
        },
      ],
    },
  ],
  pagination: { page: 1, pages: 2, total: 26, pageSize: 25 },
};

describe("AdminEventAttendanceReview", () => {
  it("explains automatic evidence while keeping staff attendance editable", () => {
    const html = renderToStaticMarkup(
      <AdminEventAttendanceReview
        report={report}
        filters={{ q: "", sessionId: "all", state: "all", evidence: "all" }}
        processingId={null}
        onFiltersChange={() => undefined}
        onPageChange={() => undefined}
        onRecordAttendance={() => undefined}
      />,
    );
    expect(html).toContain("Attendance review");
    expect(html).toContain("Staff correction preserved");
    expect(html).toContain("Estimated boundary");
    expect(html).toContain("Connection evidence explains");
    expect(html).toContain("Export filtered CSV");
    expect(html).toContain("Attendance for Alex Learner in Clinical webinar");
    expect(html).toContain("1 automatic decision");
    expect(html).toContain("Page 1 of 2");
    expect(html).toContain("Previous page");
    expect(html).toContain("Next page");
  });

  it("keeps pagination controls bounded for large reports", () => {
    const html = renderToStaticMarkup(
      <AdminEventAttendanceReview
        report={{
          ...report,
          pagination: { page: 1, pages: 4_000, total: 100_000, pageSize: 25 },
        }}
        filters={{ q: "", sessionId: "all", state: "all", evidence: "all" }}
        processingId={null}
        onFiltersChange={() => undefined}
        onPageChange={() => undefined}
        onRecordAttendance={() => undefined}
      />,
    );
    expect(html).toContain("Page 1 of 4000");
    expect(html).not.toContain("Page 2 of 4000");
  });
});
