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

  it("labels every media toggle with its next action", () => {
    const source = readFileSync(
      "src/features/event-operations/LiveKitPresenterRoom.tsx",
      "utf8",
    );

    for (const label of [
      "Turn video off",
      "Turn video on",
      "Mute microphone",
      "Unmute microphone",
      "Stop sharing screen",
      "Share screen",
    ]) {
      expect(source).toContain(`"${label}"`);
    }
    expect(source).not.toContain('"Video off"');
    expect(source).not.toContain('"Video on"');
  });

  it("shows the live recording marker only for confirmed active recording", () => {
    const source = readFileSync(
      "src/features/event-operations/EventOperationsVirtualSessions.tsx",
      "utf8",
    );
    const queueSource = readFileSync(
      "src/features/event-operations/EventOperationsLobbyQueue.tsx",
      "utf8",
    );
    const css = readFileSync(
      "src/features/event-operations/EventOperations.module.css",
      "utf8",
    );

    expect(source).not.toContain("record={");
    expect(queueSource).toContain("data-r={recording?.status}");
    expect(css).toContain(':has(.queuePanel[data-r="active"])');
  });
});
