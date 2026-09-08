import {
  GetDataAccessCommand,
  Permission,
  Privilege,
  S3PrefixType,
  type GetDataAccessCommandOutput,
} from "@aws-sdk/client-s3-control";
import { describe, expect, it, vi } from "vitest";
import {
  MAXIMUM_ACCESS_GRANTS_SESSION_SECONDS,
  S3AccessGrantsLiveKitRecordingUploadAuthorizer,
  type LiveKitRecordingS3ControlClient,
} from "./livekit-recording-upload-authorizer.access-grants.aws.server";
import { LiveKitRecordingUploadAuthorizationError } from "./livekit-recording-upload-authorizer.aws.server";

const NOW = new Date("2026-09-08T00:00:00.000Z");
const CONFIGURATION = {
  accountId: "123456789012",
  bucket: "upskill-production-recordings",
  region: "ap-southeast-2",
};
const TARGET =
  "s3://upskill-production-recordings/recordings/generation_123/recording_456.mp4";

function successfulResponse(
  expiration = new Date(NOW.getTime() + 15 * 60 * 1_000),
): GetDataAccessCommandOutput {
  return {
    $metadata: {},
    MatchedGrantTarget: TARGET,
    Credentials: {
      AccessKeyId: "temporary-access-key",
      SecretAccessKey: "temporary-secret-key",
      SessionToken: "temporary-session-token",
      Expiration: expiration,
    },
  };
}

function authorizer(
  send: LiveKitRecordingS3ControlClient["send"],
  now: () => Date = () => NOW,
): S3AccessGrantsLiveKitRecordingUploadAuthorizer {
  return new S3AccessGrantsLiveKitRecordingUploadAuthorizer(CONFIGURATION, {
    now,
    s3Control: { send },
  });
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    bucket: CONFIGURATION.bucket,
    region: CONFIGURATION.region,
    storageObjectKey: "recordings/generation_123/recording_456.mp4",
    requiredUntil: new Date(NOW.getTime() + 10 * 60 * 1_000),
    ...overrides,
  };
}

describe("S3 Access Grants LiveKit recording upload authorization", () => {
  it("requests least-privilege credentials for one exact recording object", async () => {
    const send = vi.fn<LiveKitRecordingS3ControlClient["send"]>(() =>
      Promise.resolve(successfulResponse()),
    );

    await expect(authorizer(send).authorizeUpload(request())).resolves.toEqual({
      accessKeyId: "temporary-access-key",
      secretAccessKey: "temporary-secret-key",
      sessionToken: "temporary-session-token",
      expiresAt: new Date(NOW.getTime() + 15 * 60 * 1_000),
    });

    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(GetDataAccessCommand);
    expect(command?.input).toEqual({
      AccountId: CONFIGURATION.accountId,
      Target: TARGET,
      TargetType: S3PrefixType.Object,
      Permission: Permission.WRITE,
      Privilege: Privilege.Minimal,
      DurationSeconds: 900,
      AuditContext:
        "upskill-livekit-egress:recordings/generation_123/recording_456.mp4",
    });
  });

  it("covers the exact required duration through twelve hours", async () => {
    const expiration = new Date(
      NOW.getTime() + MAXIMUM_ACCESS_GRANTS_SESSION_SECONDS * 1_000,
    );
    const send = vi.fn<LiveKitRecordingS3ControlClient["send"]>(() =>
      Promise.resolve(successfulResponse(expiration)),
    );

    await authorizer(send).authorizeUpload(
      request({ requiredUntil: expiration }),
    );

    expect(send.mock.calls[0]?.[0].input.DurationSeconds).toBe(
      MAXIMUM_ACCESS_GRANTS_SESSION_SECONDS,
    );
  });

  it.each([
    ["foreign bucket", { bucket: "another-recording-bucket" }],
    ["foreign region", { region: "us-east-1" }],
    ["malformed object key", { storageObjectKey: "../recording.mp4" }],
    ["expired requirement", { requiredUntil: new Date(NOW.getTime() - 1) }],
    [
      "requirement beyond twelve hours",
      {
        requiredUntil: new Date(
          NOW.getTime() + MAXIMUM_ACCESS_GRANTS_SESSION_SECONDS * 1_000 + 1,
        ),
      },
    ],
  ])("rejects %s before calling AWS", async (_label, overrides) => {
    const send = vi.fn<LiveKitRecordingS3ControlClient["send"]>(() =>
      Promise.resolve(successfulResponse()),
    );

    await expect(
      authorizer(send).authorizeUpload(request(overrides)),
    ).rejects.toBeInstanceOf(LiveKitRecordingUploadAuthorizationError);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["missing credentials", { $metadata: {}, MatchedGrantTarget: TARGET }],
    [
      "credentials for a broader target",
      {
        ...successfulResponse(),
        MatchedGrantTarget: "s3://upskill-production-recordings/recordings/*",
      },
    ],
    [
      "credentials expiring before the required upload deadline",
      successfulResponse(new Date(NOW.getTime() + 5 * 60 * 1_000)),
    ],
  ])("rejects %s", async (_label, response) => {
    const send = vi.fn<LiveKitRecordingS3ControlClient["send"]>(() =>
      Promise.resolve(response),
    );

    await expect(
      authorizer(send).authorizeUpload(request()),
    ).rejects.toBeInstanceOf(LiveKitRecordingUploadAuthorizationError);
  });

  it("rechecks credential expiry after the AWS call", async () => {
    const checkedAt = new Date(NOW.getTime() + 15 * 60 * 1_000);
    const times = [NOW, checkedAt];
    const send = vi.fn<LiveKitRecordingS3ControlClient["send"]>(() =>
      Promise.resolve(successfulResponse(checkedAt)),
    );

    await expect(
      authorizer(send, () => times.shift() ?? checkedAt).authorizeUpload(
        request(),
      ),
    ).rejects.toBeInstanceOf(LiveKitRecordingUploadAuthorizationError);
  });

  it("does not expose provider error details", async () => {
    const send = vi.fn<LiveKitRecordingS3ControlClient["send"]>(() =>
      Promise.reject(new Error("provider detail with temporary-secret-key")),
    );

    await expect(authorizer(send).authorizeUpload(request())).rejects.toThrow(
      "LiveKit recording upload authorization failed",
    );
    await expect(
      authorizer(send).authorizeUpload(request()),
    ).rejects.not.toThrow("temporary-secret-key");
  });
});
