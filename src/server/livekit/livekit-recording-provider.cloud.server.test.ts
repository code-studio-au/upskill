import {
  EgressInfo,
  EgressStatus,
  EncodedFileType,
  FileOutput,
  Output,
  StartEgressRequest,
  TemplateSource,
} from "livekit-server-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  LiveKitCloudRecordingProvider,
  type LiveKitRecordingUploadAuthorizer,
} from "./livekit-recording-provider.cloud.server";
import { LiveKitRecordingProviderError } from "./livekit-recording-provider.server";

const requiredUntil = new Date("2030-09-04T01:00:00.000Z");
const startInput = {
  roomName: "room_generation_1",
  storageObjectKey: "recordings/opaque_room/opaque_recording.mp4",
  uploadAuthorizationExpiresAt: requiredUntil,
  layout: "speaker" as const,
  format: "mp4" as const,
};
const configuration = {
  url: "wss://test-project.livekit.cloud",
  apiKey: "test-key",
  apiSecret: "test-secret-with-at-least-32-characters",
  region: "ap-southeast-2",
  bucket: "upskill-test-recordings",
};
const now = () => new Date("2030-09-03T23:00:00.000Z");

function providerNanoseconds(value: string): bigint {
  return BigInt(new Date(value).getTime()) * 1_000_000n;
}

function uploadAuthorizer(
  expiresAt = new Date("2030-09-04T02:00:00.000Z"),
): LiveKitRecordingUploadAuthorizer {
  return {
    authorizeUpload: vi.fn().mockResolvedValue({
      accessKeyId: "temporary-access-key",
      secretAccessKey: "temporary-secret-key",
      sessionToken: "temporary-session-token",
      expiresAt,
    }),
  };
}

describe("LiveKit Cloud recording provider", () => {
  it("starts managed speaker-layout MP4 Egress with an exact private upload target", async () => {
    let request: StartEgressRequest | undefined;
    let authorizationRequest: unknown;
    const authorizer: LiveKitRecordingUploadAuthorizer = {
      authorizeUpload: (candidate) => {
        authorizationRequest = candidate;
        return Promise.resolve({
          accessKeyId: "temporary-access-key",
          secretAccessKey: "temporary-secret-key",
          sessionToken: "temporary-session-token",
          expiresAt: new Date("2030-09-04T02:00:00.000Z"),
        });
      },
    };
    const egress = {
      startEgress: vi.fn((candidate: StartEgressRequest) => {
        request = candidate;
        return Promise.resolve(
          new EgressInfo({
            egressId: "EG_recording_1",
            roomName: startInput.roomName,
            status: EgressStatus.EGRESS_STARTING,
            request: { case: "egress", value: candidate },
          }),
        );
      }),
      listEgress: vi.fn(),
      stopEgress: vi.fn(),
    };
    const provider = new LiveKitCloudRecordingProvider(
      configuration,
      authorizer,
      egress,
      now,
    );

    await expect(
      provider.startRoomCompositeRecording(startInput),
    ).resolves.toMatchObject({
      providerEgressId: "EG_recording_1",
      roomName: startInput.roomName,
      status: "starting",
    });
    expect(authorizationRequest).toEqual({
      bucket: configuration.bucket,
      region: configuration.region,
      storageObjectKey: startInput.storageObjectKey,
      requiredUntil,
    });
    expect(request?.source).toMatchObject({
      case: "template",
      value: { layout: "speaker", audioOnly: false, videoOnly: false },
    });
    expect(request?.outputs).toHaveLength(1);
    expect(request?.outputs[0]?.config).toMatchObject({
      case: "file",
      value: {
        fileType: EncodedFileType.MP4,
        filepath: startInput.storageObjectKey,
        disableManifest: true,
      },
    });
    expect(request?.storage?.provider).toMatchObject({
      case: "s3",
      value: {
        accessKey: "temporary-access-key",
        secret: "temporary-secret-key",
        sessionToken: "temporary-session-token",
        region: configuration.region,
        bucket: configuration.bucket,
      },
    });
  });

  it("refuses upload authorization that expires before finalisation", async () => {
    const egress = {
      startEgress: vi.fn(),
      listEgress: vi.fn(),
      stopEgress: vi.fn(),
    };
    const provider = new LiveKitCloudRecordingProvider(
      configuration,
      uploadAuthorizer(new Date("2030-09-04T00:59:59.000Z")),
      egress,
      now,
    );

    const failure = await provider
      .startRoomCompositeRecording(startInput)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LiveKitRecordingProviderError);
    expect(String(failure)).not.toContain("temporary");
    expect(egress.startEgress).not.toHaveBeenCalled();
  });

  it("normalises active, complete and bounded provider failure states", async () => {
    const startedAt = providerNanoseconds("2030-09-03T23:32:00.000Z");
    const endedAt = providerNanoseconds("2030-09-04T00:32:00.000Z");
    const request = new StartEgressRequest({
      roomName: startInput.roomName,
      source: {
        case: "template",
        value: new TemplateSource({ layout: "speaker" }),
      },
      outputs: [
        new Output({
          config: {
            case: "file",
            value: new FileOutput({
              fileType: EncodedFileType.MP4,
              filepath: startInput.storageObjectKey,
              disableManifest: true,
            }),
          },
        }),
      ],
    });
    const egress = {
      startEgress: vi.fn(),
      listEgress: vi.fn().mockResolvedValue([
        new EgressInfo({
          egressId: "EG_active",
          roomName: startInput.roomName,
          status: EgressStatus.EGRESS_ACTIVE,
          startedAt,
          request: { case: "egress", value: request },
        }),
        new EgressInfo({
          egressId: "EG_complete",
          roomName: startInput.roomName,
          status: EgressStatus.EGRESS_COMPLETE,
          startedAt,
          endedAt,
          request: { case: "egress", value: request },
          fileResults: [
            {
              filename: startInput.storageObjectKey,
              duration: 3_600_000_000_000n,
              size: 1_048_576n,
            },
          ],
        }),
        new EgressInfo({
          egressId: "EG_failed",
          roomName: startInput.roomName,
          status: EgressStatus.EGRESS_FAILED,
          error: "raw provider detail that must not escape",
          request: { case: "egress", value: request },
        }),
      ]),
      stopEgress: vi.fn(),
    };
    const provider = new LiveKitCloudRecordingProvider(
      configuration,
      uploadAuthorizer(),
      egress,
      now,
    );

    await expect(
      provider.listRoomCompositeRecordings(startInput.roomName),
    ).resolves.toEqual([
      {
        providerEgressId: "EG_active",
        roomName: startInput.roomName,
        status: "active",
        startedAt: new Date("2030-09-03T23:32:00.000Z"),
        endedAt: null,
        output: null,
        failureCode: null,
      },
      {
        providerEgressId: "EG_complete",
        roomName: startInput.roomName,
        status: "complete",
        startedAt: new Date("2030-09-03T23:32:00.000Z"),
        endedAt: new Date("2030-09-04T00:32:00.000Z"),
        output: {
          storageObjectKey: startInput.storageObjectKey,
          fileSizeBytes: 1_048_576n,
          durationNanoseconds: 3_600_000_000_000n,
        },
        failureCode: null,
      },
      {
        providerEgressId: "EG_failed",
        roomName: startInput.roomName,
        status: "failed",
        startedAt: null,
        endedAt: null,
        output: null,
        failureCode: "provider_failed",
      },
    ]);
  });

  it("rejects cross-room stop responses without exposing provider details", async () => {
    const egress = {
      startEgress: vi.fn(),
      listEgress: vi.fn(),
      stopEgress: vi.fn().mockResolvedValue(
        new EgressInfo({
          egressId: "EG_recording_1",
          roomName: "other_room",
          status: EgressStatus.EGRESS_FAILED,
          error: "secret provider detail",
        }),
      ),
    };
    const provider = new LiveKitCloudRecordingProvider(
      configuration,
      uploadAuthorizer(),
      egress,
      now,
    );

    const failure = await provider
      .stopRoomCompositeRecording({
        roomName: startInput.roomName,
        providerEgressId: "EG_recording_1",
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LiveKitRecordingProviderError);
    expect(String(failure)).not.toContain("secret provider detail");
  });
});
