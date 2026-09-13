import { readFileSync } from "node:fs";
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
        record={false}
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
        record={false}
      />,
    );

    expect(html).not.toContain("Recording notice");
  });

  it("ships direct media-control icons without an external symbol sprite", () => {
    const source = readFileSync(
      "src/features/event-operations/LiveKitPresenterRoom.tsx",
      "utf8",
    );
    expect(source).toContain(
      'src={`/brand/${control}-${enabled ? "1" : "0"}.svg`}',
    );
    expect(source).not.toContain("<use");

    for (const control of ["camera", "microphone", "screen"]) {
      for (const state of ["0", "1"]) {
        expect(
          readFileSync(`public/brand/${control}-${state}.svg`, "utf8"),
        ).toContain("<svg");
      }
    }
  });
});
