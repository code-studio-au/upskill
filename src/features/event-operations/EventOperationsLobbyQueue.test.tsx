import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EventOperationsWorkspace } from "./event-operations.schema";
import { EventOperationsLobbyQueue } from "./EventOperationsLobbyQueue";

type VirtualSession = EventOperationsWorkspace["virtualSessions"][number];

const room: NonNullable<VirtualSession["room"]> = {
  id: "event_virtual_room_1",
  eventSessionId: "event_session_1",
  generation: 1,
  maxParticipants: 10,
  doorState: "open",
  admissionMode: "manual",
  providerStatus: "ready",
  providerErrorCode: null,
  createdAt: "2030-09-04T00:00:00.000Z",
  startedAt: "2030-09-04T00:01:00.000Z",
  lockedAt: null,
  reopenedAt: null,
  endedAt: null,
};

function renderRecording(
  recording: VirtualSession["recordings"][number],
): string {
  const session: VirtualSession = {
    eventSessionId: room.eventSessionId,
    preparationOpensAt: "2030-09-03T23:00:00.000Z",
    canEnterGreenRoom: true,
    presenterRecordingNotice: "This webinar is recorded.",
    lobbyPath: "/webinars/reference",
    room,
    recording,
    recordings: [recording],
  };
  return renderToStaticMarkup(
    <EventOperationsLobbyQueue
      eventOccurrenceId="event_occurrence_1"
      session={session}
      room={room}
      processingId={null}
      changeAdmission={() => Promise.resolve()}
      changeAdmissionMode={() => undefined}
    />,
  );
}

describe("LiveKit operations recording status", () => {
  it("warns staff while an automatic recording operation is retrying", () => {
    const html = renderRecording({
      recordingId: "recording_1",
      roomGeneration: room.generation,
      statusLabel: "Requested",
      status: "requested",
      warning:
        "Automatic recording is delayed. Background retries are continuing; ask an administrator to check the recording service if this persists.",
    });

    expect(html).toContain("Automatic recording is delayed");
    expect(html).toContain("Background retries are continuing");
    expect(html).toContain('role="alert"');
  });

  it("shows an actionable warning when automatic recording fails", () => {
    const html = renderRecording({
      recordingId: "recording_1",
      roomGeneration: room.generation,
      statusLabel: "Failed",
      status: "failed",
      warning:
        "Automatic recording failed. Keep the webinar running and arrange a manual follow-up; an administrator can review the recording evidence after the session.",
    });

    expect(html).toContain("Automatic recording failed");
    expect(html).toContain("arrange a manual follow-up");
    expect(html).toContain('role="alert"');
  });
});
