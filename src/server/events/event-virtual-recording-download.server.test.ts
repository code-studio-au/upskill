import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerEnv: vi.fn(),
}));

vi.mock("#/server/env.server", () => ({
  getServerEnv: mocks.getServerEnv,
}));

import {
  issueEventVirtualRecordingDownloadToken,
  verifyEventVirtualRecordingDownloadToken,
} from "./event-virtual-recording-download.server";

const now = new Date("2026-09-12T06:00:00.000Z");
const expected = {
  eventOccurrenceId: "occurrence_1",
  recordingId: "recording_1",
  userId: "administrator_1",
};

describe("recording download token", () => {
  beforeEach(() => {
    mocks.getServerEnv.mockReset();
    mocks.getServerEnv.mockReturnValue({
      BETTER_AUTH_SECRET: "test-only-secret-with-more-than-32-characters",
    });
  });

  it("binds a short-lived token to the exact administrator and recording", () => {
    const claims = {
      ...expected,
      expiresAt: now.getTime() + 60_000,
    };
    const token = issueEventVirtualRecordingDownloadToken(claims);

    expect(
      verifyEventVirtualRecordingDownloadToken(token, expected, now),
    ).toEqual(claims);
    expect(
      verifyEventVirtualRecordingDownloadToken(
        token,
        { ...expected, userId: "administrator_2" },
        now,
      ),
    ).toBeNull();
    expect(
      verifyEventVirtualRecordingDownloadToken(
        token,
        { ...expected, recordingId: "recording_2" },
        now,
      ),
    ).toBeNull();
  });

  it("rejects expired, overlong and tampered tokens", () => {
    const expired = issueEventVirtualRecordingDownloadToken({
      ...expected,
      expiresAt: now.getTime(),
    });
    const tooLong = issueEventVirtualRecordingDownloadToken({
      ...expected,
      expiresAt: now.getTime() + 60_001,
    });
    const valid = issueEventVirtualRecordingDownloadToken({
      ...expected,
      expiresAt: now.getTime() + 60_000,
    });
    const separator = valid.indexOf(".");
    const tampered = `${valid.slice(0, separator)}.${"a".repeat(43)}`;

    expect(
      verifyEventVirtualRecordingDownloadToken(expired, expected, now),
    ).toBeNull();
    expect(
      verifyEventVirtualRecordingDownloadToken(tooLong, expected, now),
    ).toBeNull();
    expect(
      verifyEventVirtualRecordingDownloadToken(tampered, expected, now),
    ).toBeNull();
  });
});
