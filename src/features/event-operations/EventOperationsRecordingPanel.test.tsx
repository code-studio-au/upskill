import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  formatRecordingDuration,
  formatRecordingSize,
} from "./event-operations-recording-format";
import EventOperationsRecordingPanel from "./EventOperationsRecordingPanel";

const details = {
  recordingId: "event_virtual_recording_1",
  completedAt: "2030-10-04T00:46:00.000Z",
  fileSizeBytes: "8388608",
  durationNanoseconds: "240000000000",
  retentionDeadline: "2030-11-03T00:46:00.000Z",
  downloadAvailable: true,
};

function render(downloadAvailable: boolean): string {
  return renderToStaticMarkup(
    <EventOperationsRecordingPanel
      eventOccurrenceId="event_occurrence_1"
      timezone="Australia/Sydney"
      recording={{
        status: "complete",
        warning: null,
        details: { ...details, downloadAvailable },
      }}
      processingId={null}
      action={() => Promise.resolve()}
    />,
  );
}

describe("event operations recording download", () => {
  it("shows completed recording evidence and the administrator download action", () => {
    const html = render(true);

    expect(html).toContain("Recording");
    expect(html).toContain("Ready");
    expect(html).toContain("Completed");
    expect(html).toContain("4 min");
    expect(html).toContain("8 MB");
    expect(html).toContain("Available until");
    expect(html).toContain("Download recording");
  });

  it("removes the download action after the retention window", () => {
    const html = render(false);

    expect(html).not.toContain("Download recording");
    expect(html).toContain("no longer available to download");
  });

  it("formats longer durations and rejects malformed evidence safely", () => {
    expect(formatRecordingDuration("7260000000000")).toBe("2 hr 1 min");
    expect(formatRecordingDuration("invalid")).toBe("Unavailable");
    expect(formatRecordingSize("invalid")).toBe("Unavailable");
  });
});
