import {
  AssumeRoleCommand,
  type AssumeRoleCommandOutput,
} from "@aws-sdk/client-sts";
import { describe, expect, it, vi } from "vitest";
import {
  AwsLiveKitRecordingUploadAuthorizer,
  LiveKitRecordingUploadAuthorizationError,
  type LiveKitRecordingStsClient,
} from "./livekit-recording-upload-authorizer.aws.server";

const NOW = new Date("2026-09-07T00:00:00.000Z");
const CONFIGURATION = {
  bucket: "upskill-staging-recordings",
  region: "ap-southeast-2",
  roleArn: "arn:aws:iam::123456789012:role/upskill-recording-upload",
};

function successfulResponse(
  expiration = new Date(NOW.getTime() + 15 * 60 * 1_000),
): AssumeRoleCommandOutput {
  return {
    $metadata: {},
    Credentials: {
      AccessKeyId: "temporary-access-key",
      SecretAccessKey: "temporary-secret-key",
      SessionToken: "temporary-session-token",
      Expiration: expiration,
    },
  };
}

function authorizer(
  send: LiveKitRecordingStsClient["send"],
  now: () => Date = () => NOW,
): AwsLiveKitRecordingUploadAuthorizer {
  return new AwsLiveKitRecordingUploadAuthorizer(CONFIGURATION, {
    now,
    sessionId: () => "f51e8a55-77b4-4af0-8f41-a34812c68ace",
    sts: { send },
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

describe("AWS LiveKit recording upload authorization", () => {
  it("assumes only the configured role with an exact-object session policy", async () => {
    const send = vi.fn<LiveKitRecordingStsClient["send"]>(() =>
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
    expect(command).toBeInstanceOf(AssumeRoleCommand);
    expect(command?.input).toMatchObject({
      RoleArn: CONFIGURATION.roleArn,
      RoleSessionName: "upskill-egress-f51e8a55-77b4-4af0-8f41-a34812c68ace",
      DurationSeconds: 900,
    });
    expect(JSON.parse(command?.input.Policy ?? "{}")).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "WriteExactRecordingObject",
          Effect: "Allow",
          Action: "s3:PutObject",
          Resource:
            "arn:aws:s3:::upskill-staging-recordings/recordings/generation_123/recording_456.mp4",
        },
      ],
    });
  });

  it("requests the exact required duration up to the role-chain ceiling", async () => {
    const expiration = new Date(NOW.getTime() + 60 * 60 * 1_000);
    const send = vi.fn<LiveKitRecordingStsClient["send"]>(() =>
      Promise.resolve(successfulResponse(expiration)),
    );

    await authorizer(send).authorizeUpload(
      request({ requiredUntil: expiration }),
    );

    expect(send.mock.calls[0]?.[0].input.DurationSeconds).toBe(3_600);
  });

  it.each([
    ["foreign bucket", { bucket: "another-recording-bucket" }],
    ["foreign region", { region: "us-east-1" }],
    ["malformed object key", { storageObjectKey: "../recording.mp4" }],
    ["expired requirement", { requiredUntil: new Date(NOW.getTime() - 1) }],
    [
      "requirement beyond one hour",
      { requiredUntil: new Date(NOW.getTime() + 60 * 60 * 1_000 + 1) },
    ],
  ])("rejects %s before calling AWS", async (_label, overrides) => {
    const send = vi.fn<LiveKitRecordingStsClient["send"]>(() =>
      Promise.resolve(successfulResponse()),
    );

    await expect(
      authorizer(send).authorizeUpload(request(overrides)),
    ).rejects.toBeInstanceOf(LiveKitRecordingUploadAuthorizationError);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["missing credentials", { $metadata: {} }],
    [
      "incomplete credentials",
      {
        $metadata: {},
        Credentials: {
          AccessKeyId: "temporary-access-key",
          SecretAccessKey: "temporary-secret-key",
          Expiration: new Date(NOW.getTime() + 15 * 60 * 1_000),
        },
      },
    ],
    [
      "credentials expiring before the required upload deadline",
      successfulResponse(new Date(NOW.getTime() + 5 * 60 * 1_000)),
    ],
  ])("rejects %s", async (_label, response) => {
    const send = vi.fn<LiveKitRecordingStsClient["send"]>(() =>
      Promise.resolve(response as AssumeRoleCommandOutput),
    );

    await expect(
      authorizer(send).authorizeUpload(request()),
    ).rejects.toBeInstanceOf(LiveKitRecordingUploadAuthorizationError);
  });

  it("rechecks credential expiry after the AWS call", async () => {
    const checkedAt = new Date(NOW.getTime() + 15 * 60 * 1_000);
    const times = [NOW, checkedAt];
    const send = vi.fn<LiveKitRecordingStsClient["send"]>(() =>
      Promise.resolve(successfulResponse(checkedAt)),
    );

    await expect(
      authorizer(send, () => times.shift() ?? checkedAt).authorizeUpload(
        request(),
      ),
    ).rejects.toBeInstanceOf(LiveKitRecordingUploadAuthorizationError);
  });

  it("does not expose provider error details", async () => {
    const send = vi.fn<LiveKitRecordingStsClient["send"]>(() =>
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
