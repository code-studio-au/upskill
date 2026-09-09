import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AttendeeRecordingNotice } from "./AttendeeRecordingNotice";

describe("attendee recording notice", () => {
  it("renders the exact immutable notice for the ready and connected view", () => {
    const notice = "This exact attendee notice is part of the session policy.";
    const html = renderToStaticMarkup(
      <AttendeeRecordingNotice notice={notice} />,
    );

    expect(html).toContain("Recording notice");
    expect(html).toContain(notice);
  });

  it("does not invent a recording notice when recording is off", () => {
    expect(
      renderToStaticMarkup(<AttendeeRecordingNotice notice={null} />),
    ).toBe("");
  });
});
