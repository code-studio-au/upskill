import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LiveKitPresenterRoom } from "./LiveKitPresenterRoom";

describe("LiveKit presenter recording notice", () => {
  it("shows the immutable automatic-recording notice before green-room entry", () => {
    const notice = "This exact presenter notice is part of the session policy.";
    const html = renderToStaticMarkup(
      <LiveKitPresenterRoom
        eventOccurrenceId="event_occurrence_1"
        eventSessionId="event_session_1"
        presenterRecordingNotice={notice}
      />,
    );

    expect(html).toContain("Recording notice");
    expect(html).toContain(notice);
    expect(html.indexOf(notice)).toBeLessThan(html.indexOf("Enter green room"));
  });

  it("does not invent a recording notice when recording is off", () => {
    const html = renderToStaticMarkup(
      <LiveKitPresenterRoom
        eventOccurrenceId="event_occurrence_1"
        eventSessionId="event_session_1"
        presenterRecordingNotice={null}
      />,
    );

    expect(html).not.toContain("Recording notice");
  });
});
