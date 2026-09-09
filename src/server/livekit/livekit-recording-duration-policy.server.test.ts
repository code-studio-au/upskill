import { describe, expect, it } from "vitest";
import {
  LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY,
  LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY,
  MAXIMUM_AUTOMATIC_RECORDING_SESSION_MINUTES,
  recordingUploadAuthorizationExpiresAt,
  supportsAutomaticRecordingDurations,
} from "./livekit-recording-duration-policy.server";

const NOW = new Date("2030-09-03T23:30:00.000Z");

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

  it("reserves five minutes within the one-hour role-chain ceiling", () => {
    expect(
      recordingUploadAuthorizationExpiresAt({
        authorizationStartsAt: NOW,
        scheduledDurationMilliseconds: 55 * 60 * 1_000,
        checkedAt: NOW,
        policy: LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY,
      }),
    ).toEqual(new Date("2030-09-04T00:30:00.000Z"));
    expect(
      recordingUploadAuthorizationExpiresAt({
        authorizationStartsAt: NOW,
        scheduledDurationMilliseconds: 55 * 60 * 1_000 + 1,
        checkedAt: NOW,
        policy: LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY,
      }),
    ).toBeNull();
  });

  it("reserves one hour within the twelve-hour Access Grants ceiling", () => {
    expect(
      recordingUploadAuthorizationExpiresAt({
        authorizationStartsAt: NOW,
        scheduledDurationMilliseconds:
          MAXIMUM_AUTOMATIC_RECORDING_SESSION_MINUTES * 60 * 1_000,
        checkedAt: NOW,
        policy: LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY,
      }),
    ).toEqual(new Date("2030-09-04T11:30:00.000Z"));
  });
});
