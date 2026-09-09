import { describe, expect, it } from "vitest";
import {
  LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY,
  LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY,
  maximumAutomaticRecordingWindowMinutes,
  recordingUploadAuthorizationPolicyForEnvironment,
  recordingUploadAuthorizationExpiresAt,
  supportsAutomaticRecordingDurations,
  supportsAutomaticRecordingSessionWindow,
} from "./livekit-recording-duration-policy.server";

const NOW = new Date("2030-09-03T23:30:00.000Z");

function draftWithSession(
  durationMinutes: number,
  recordingMode: "automatic" | "off",
  presenterPreparationMinutes = 0,
) {
  return {
    sections: [
      {
        items: [
          {
            kind: "session",
            durationMinutes,
            liveKitPolicy: { recordingMode, presenterPreparationMinutes },
          },
        ],
      },
    ],
  };
}

describe("LiveKit recording duration policy", () => {
  it("applies the active environment's authorization ceiling while authoring", () => {
    const roleChainedPolicy =
      recordingUploadAuthorizationPolicyForEnvironment("test");
    const accessGrantsPolicy =
      recordingUploadAuthorizationPolicyForEnvironment("production");
    expect(maximumAutomaticRecordingWindowMinutes(roleChainedPolicy)).toBe(55);
    expect(maximumAutomaticRecordingWindowMinutes(accessGrantsPolicy)).toBe(
      660,
    );
    expect(
      supportsAutomaticRecordingDurations(
        draftWithSession(55, "automatic", 0),
        roleChainedPolicy,
      ),
    ).toBe(true);
    expect(
      supportsAutomaticRecordingDurations(
        draftWithSession(54, "automatic", 1),
        roleChainedPolicy,
      ),
    ).toBe(true);
    expect(
      supportsAutomaticRecordingDurations(
        draftWithSession(55, "automatic", 1),
        roleChainedPolicy,
      ),
    ).toBe(false);
    expect(
      supportsAutomaticRecordingDurations(
        draftWithSession(1, "automatic", 60),
        roleChainedPolicy,
      ),
    ).toBe(false);
    expect(
      supportsAutomaticRecordingDurations(
        draftWithSession(600, "automatic", 60),
        accessGrantsPolicy,
      ),
    ).toBe(true);
    expect(
      supportsAutomaticRecordingDurations(
        draftWithSession(601, "automatic", 60),
        accessGrantsPolicy,
      ),
    ).toBe(false);
  });

  it("does not reduce the duration limit for sessions that are not recorded", () => {
    expect(
      supportsAutomaticRecordingDurations(
        draftWithSession(7 * 24 * 60, "off"),
        LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY,
      ),
    ).toBe(true);
  });

  it("checks retained session instants against the provider reserve", () => {
    expect(
      supportsAutomaticRecordingSessionWindow(
        55 * 60 * 1_000,
        0,
        LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY,
      ),
    ).toBe(true);
    expect(
      supportsAutomaticRecordingSessionWindow(
        54 * 60 * 1_000 + 1,
        60 * 1_000,
        LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY,
      ),
    ).toBe(false);
  });

  it("reserves five minutes within the one-hour role-chain ceiling", () => {
    expect(
      recordingUploadAuthorizationExpiresAt({
        authorizationStartsAt: NOW,
        scheduledDurationMilliseconds: 55 * 60 * 1_000,
        scheduledEndsAt: new Date("2030-09-04T00:25:00.000Z"),
        checkedAt: NOW,
        policy: LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY,
      }),
    ).toEqual(new Date("2030-09-04T00:30:00.000Z"));
    expect(
      recordingUploadAuthorizationExpiresAt({
        authorizationStartsAt: NOW,
        scheduledDurationMilliseconds: 55 * 60 * 1_000 + 1,
        scheduledEndsAt: new Date("2030-09-04T00:25:00.000Z"),
        checkedAt: NOW,
        policy: LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY,
      }),
    ).toBeNull();
  });

  it("covers an early start through the scheduled end and provider reserve", () => {
    expect(
      recordingUploadAuthorizationExpiresAt({
        authorizationStartsAt: NOW,
        scheduledDurationMilliseconds: 25 * 60 * 1_000,
        scheduledEndsAt: new Date("2030-09-04T00:25:00.000Z"),
        checkedAt: NOW,
        policy: LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY,
      }),
    ).toEqual(new Date("2030-09-04T00:30:00.000Z"));
    expect(
      recordingUploadAuthorizationExpiresAt({
        authorizationStartsAt: NOW,
        scheduledDurationMilliseconds: 55 * 60 * 1_000,
        scheduledEndsAt: new Date("2030-09-04T00:55:00.000Z"),
        checkedAt: NOW,
        policy: LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY,
      }),
    ).toBeNull();
  });

  it("extends a late start for the full scheduled duration and reserve", () => {
    expect(
      recordingUploadAuthorizationExpiresAt({
        authorizationStartsAt: new Date("2030-09-04T00:05:00.000Z"),
        scheduledDurationMilliseconds: 25 * 60 * 1_000,
        scheduledEndsAt: new Date("2030-09-04T00:25:00.000Z"),
        checkedAt: new Date("2030-09-04T00:05:00.000Z"),
        policy: LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY,
      }),
    ).toEqual(new Date("2030-09-04T00:35:00.000Z"));
  });

  it("reserves one hour within the twelve-hour Access Grants ceiling", () => {
    const maximumSessionMinutes = maximumAutomaticRecordingWindowMinutes(
      LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY,
    );
    expect(
      recordingUploadAuthorizationExpiresAt({
        authorizationStartsAt: NOW,
        scheduledDurationMilliseconds: maximumSessionMinutes * 60 * 1_000,
        scheduledEndsAt: new Date("2030-09-04T10:30:00.000Z"),
        checkedAt: NOW,
        policy: LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY,
      }),
    ).toEqual(new Date("2030-09-04T11:30:00.000Z"));
  });
});
