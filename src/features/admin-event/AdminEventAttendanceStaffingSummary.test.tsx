import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminEventAttendanceStaffingSummary } from "./AdminEventAttendanceStaffingSummary";

describe("AdminEventAttendanceStaffingSummary", () => {
  it("summarises administrator and presenter coverage", () => {
    const html = renderToStaticMarkup(
      <AdminEventAttendanceStaffingSummary
        timezone="Australia/Sydney"
        administrators={[
          { id: "admin-one", name: "Admin One", email: "admin@example.com" },
        ]}
        sessions={[
          {
            id: "session-covered",
            title: "Covered session",
            startsAt: "2030-09-04T00:00:00.000Z",
            endsAt: "2030-09-04T01:00:00.000Z",
            presenters: [
              {
                id: "presenter-one",
                name: "Presenter One",
                email: "presenter@example.com",
              },
            ],
            attendance: [],
          },
          {
            id: "session-uncovered",
            title: "Uncovered session",
            startsAt: "2030-09-04T02:00:00.000Z",
            endsAt: "2030-09-04T03:00:00.000Z",
            presenters: [],
            attendance: [],
          },
        ]}
      />,
    );
    expect(html).toContain("Staffing coverage");
    expect(html).toContain("2 sessions");
    expect(html).toContain("1 assigned");
    expect(html).toContain("Presenter covered");
    expect(html).toContain("Presenter needed");
    expect(html).toContain("Presenter One");
    expect(html).toContain("No presenters assigned");
  });
});
