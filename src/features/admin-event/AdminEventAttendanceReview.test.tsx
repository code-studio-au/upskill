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
      automaticEvidenceTotal: 1,
      intervalEvidenceTotal: 1,
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
  evidenceTruncated: false,
  pagination: { page: 1, pages: 2, total: 26, allTotal: 26, pageSize: 25 },
};

describe("AdminEventAttendanceReview", () => {
  it("explains automatic evidence while keeping staff attendance editable", () => {
    const html = renderToStaticMarkup(
      <AdminEventAttendanceReview
        report={report}
        filters={{
          q: "Alex",
          sessionId: "all",
          state: "all",
          evidence: "all",
        }}
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
    expect(html).toContain("Export all evidence (26 records)");
    expect(html).toContain("Attendance for Alex Learner in Clinical webinar");
    expect(html).toContain("1 automatic decision");
    expect(html).toContain("Automatic duration · 20m minimum");
    expect(html).toContain("Page 1 of 2");
    expect(html).toContain("Previous page");
    expect(html).toContain("Next page");
  });

  it("identifies automatic check-in decisions without a duration threshold", () => {
    const html = renderToStaticMarkup(
      <AdminEventAttendanceReview
        report={{
          ...report,
          rows: report.rows.map((row) => ({
            ...row,
            decisions: row.decisions.map((decision) => ({
              ...decision,
              attendanceMode: "automatic_check_in" as const,
              attendanceMinimumMinutes: null,
            })),
          })),
        }}
        filters={{ q: "", sessionId: "all", state: "all", evidence: "all" }}
        processingId={null}
        onFiltersChange={() => undefined}
        onPageChange={() => undefined}
        onRecordAttendance={() => undefined}
      />,
    );
    expect(html).toContain("Automatic check-in");
    expect(html).not.toContain("minimum");
  });

  it("keeps pagination controls bounded for large reports", () => {
    const html = renderToStaticMarkup(
      <AdminEventAttendanceReview
        report={{
          ...report,
          pagination: {
            page: 1,
            pages: 4_000,
            total: 100_000,
            allTotal: 100_000,
            pageSize: 25,
          },
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

  it("uses one confirmed broad-export action when no filters are active", () => {
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
    expect(html).not.toContain("Export filtered CSV");
    expect(html.match(/Export all evidence \(26 records\)/gu)).toHaveLength(1);
  });

  it("directs administrators to the export when page evidence is truncated", () => {
    const html = renderToStaticMarkup(
      <AdminEventAttendanceReview
        report={{ ...report, evidenceTruncated: true }}
        filters={{ q: "", sessionId: "all", state: "all", evidence: "all" }}
        processingId={null}
        onFiltersChange={() => undefined}
        onPageChange={() => undefined}
        onRecordAttendance={() => undefined}
      />,
    );
    expect(html).toContain("bounded evidence preview");
    expect(html).toContain("Export the filtered CSV");
  });

  it("does not describe omitted evidence as absent", () => {
    const html = renderToStaticMarkup(
      <AdminEventAttendanceReview
        report={{
          ...report,
          evidenceTruncated: true,
          rows: report.rows.map((row) => ({
            ...row,
            decisions: [],
            intervals: [],
          })),
        }}
        filters={{ q: "", sessionId: "all", state: "all", evidence: "all" }}
        processingId={null}
        onFiltersChange={() => undefined}
        onPageChange={() => undefined}
        onRecordAttendance={() => undefined}
      />,
    );
    expect(html).toContain("Showing 0 of 2 LiveKit evidence records");
    expect(html).toContain("partially omitted from the preview");
    expect(html).not.toContain("<summary>No LiveKit evidence</summary>");
  });
});
