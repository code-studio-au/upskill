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

function recording(roomGeneration: number, accessAvailable: boolean) {
  return {
    recordingId: `${details.recordingId}_${String(roomGeneration)}`,
    roomGeneration,
    statusLabel: "Ready",
    status: "complete" as const,
    warning: null,
    details: {
      ...details,
      recordingId: `${details.recordingId}_${String(roomGeneration)}`,
      downloadAvailable: accessAvailable,
    },
  };
}

function render(downloadAvailable: boolean): string {
  return renderToStaticMarkup(
    <EventOperationsRecordingPanel
      eventOccurrenceId="event_occurrence_1"
      timezone="Australia/Sydney"
      recordings={[recording(1, downloadAvailable)]}
      processingId={null}
      action={() => Promise.resolve()}
    />,
  );
}

describe("event operations recording download", () => {
  it("shows completed recording evidence and the administrator download action", () => {
    const html = render(true);

    expect(html).toContain("Recordings");
    expect(html).toContain("Generation 1");
    expect(html).toContain("Ready");
    expect(html).toContain("Completed");
    expect(html).toContain("4 min");
    expect(html).toContain("8 MB");
    expect(html).toContain("Available until");
    expect(html).toContain(">Play<");
    expect(html).toContain(">Download<");
    expect(html).toContain(
      "/api/play/event_virtual_recording_1_1?occurrence=event_occurrence_1",
    );
  });

  it("keeps retained recordings from every room generation visible", () => {
    const html = renderToStaticMarkup(
      <EventOperationsRecordingPanel
        eventOccurrenceId="event_occurrence_1"
        timezone="Australia/Sydney"
        recordings={[recording(2, true), recording(1, true)]}
        processingId={null}
        action={() => Promise.resolve()}
      />,
    );

    expect(html).toContain("Generation 2");
    expect(html).toContain("Generation 1");
    expect(html.match(/>Download</gu)).toHaveLength(2);
    expect(html.match(/>Play</gu)).toHaveLength(2);
  });

  it("removes the download action after the retention window", () => {
    const html = renderToStaticMarkup(
      <EventOperationsRecordingPanel
        eventOccurrenceId="event_occurrence_1"
        timezone="Australia/Sydney"
        recordings={[{ ...recording(1, false), statusLabel: "Expired" }]}
        processingId={null}
        action={() => Promise.resolve()}
      />,
    );

    expect(html).not.toContain(">Download<");
    expect(html).not.toContain(">Play<");
    expect(html).toContain("Expired");
  });

  it("offers confirmed deletion and exposes retryable storage failure", () => {
    const readyHtml = render(true);
    expect(readyHtml).toContain("Delete recording");

    const failedHtml = renderToStaticMarkup(
      <EventOperationsRecordingPanel
        eventOccurrenceId="event_occurrence_1"
        timezone="Australia/Sydney"
        recordings={[
          {
            ...recording(1, false),
            deletion: {
              status: "failed",
            },
            warning:
              "Recording storage deletion failed after 2 attempts. An automatic retry is scheduled, or retry now.",
          },
        ]}
        processingId={null}
        action={() => Promise.resolve()}
      />,
    );

    expect(failedHtml).not.toContain(">Play<");
    expect(failedHtml).not.toContain(">Download<");
    expect(failedHtml).toContain("Retry deletion");
    expect(failedHtml).toContain(
      "Recording storage deletion failed after 2 attempts. An automatic retry is scheduled, or retry now.",
    );
  });

  it("keeps deleted recording evidence visible after storage removal", () => {
    const html = renderToStaticMarkup(
      <EventOperationsRecordingPanel
        eventOccurrenceId="event_occurrence_1"
        timezone="Australia/Sydney"
        recordings={[
          {
            ...recording(1, false),
            status: "deleted",
            statusLabel: "Deleted",
            warning:
              "Deleted from private storage. Recording history has been retained.",
            deletion: {
              status: "succeeded",
            },
          },
        ]}
        processingId={null}
        action={() => Promise.resolve()}
      />,
    );

    expect(html).toContain("Deleted");
    expect(html).toContain(
      "Deleted from private storage. Recording history has been retained.",
    );
    expect(html).not.toContain("Delete recording");
  });

  it("keeps a failed recording visible and offers private-storage cleanup", () => {
    const html = renderToStaticMarkup(
      <EventOperationsRecordingPanel
        eventOccurrenceId="event_occurrence_1"
        timezone="Australia/Sydney"
        recordings={[
          {
            recordingId: "failed_recording_1",
            roomGeneration: 3,
            statusLabel: "Failed",
            status: "failed",
            warning: "Automatic recording failed. Arrange a manual follow-up.",
          },
        ]}
        processingId={null}
        action={() => Promise.resolve()}
      />,
    );

    expect(html).toContain("Generation 3");
    expect(html).toContain("Failed");
    expect(html).toContain(
      "Automatic recording failed. Arrange a manual follow-up.",
    );
    expect(html).toContain("Delete recording");
  });

  it("formats longer durations and rejects malformed evidence safely", () => {
    expect(formatRecordingDuration("7260000000000")).toBe("2 hr 1 min");
    expect(formatRecordingDuration("invalid")).toBe("Unavailable");
    expect(formatRecordingSize("invalid")).toBe("Unavailable");
  });
});
