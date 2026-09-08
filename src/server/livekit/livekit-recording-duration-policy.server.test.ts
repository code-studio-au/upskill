import { describe, expect, it } from "vitest";
import {
  MAXIMUM_AUTOMATIC_RECORDING_SESSION_MINUTES,
  supportsAutomaticRecordingDurations,
} from "./livekit-recording-duration-policy.server";

function draftWithSession(
  durationMinutes: number,
  recordingMode: "automatic" | "off",
) {
  return {
    sections: [
      {
        items: [
          {
            kind: "session",
            durationMinutes,
            liveKitPolicy: { recordingMode },
          },
        ],
      },
    ],
  };
}

describe("LiveKit recording duration policy", () => {
  it("reserves one hour of the 12-hour credential lifetime for finalization", () => {
    expect(
      supportsAutomaticRecordingDurations(
        draftWithSession(
          MAXIMUM_AUTOMATIC_RECORDING_SESSION_MINUTES,
          "automatic",
        ),
      ),
    ).toBe(true);
    expect(
      supportsAutomaticRecordingDurations(
        draftWithSession(
          MAXIMUM_AUTOMATIC_RECORDING_SESSION_MINUTES + 1,
          "automatic",
        ),
      ),
    ).toBe(false);
  });

  it("does not reduce the duration limit for sessions that are not recorded", () => {
    expect(
      supportsAutomaticRecordingDurations(draftWithSession(7 * 24 * 60, "off")),
    ).toBe(true);
  });
});
