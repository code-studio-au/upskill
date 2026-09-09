import {
  EgressInfo,
  EgressStatus,
  EncodedFileType,
  FileOutput,
  Output,
  S3Upload,
  StartEgressRequest,
  StorageConfig,
  TemplateSource,
} from "livekit-server-sdk";
import { describe, expect, it, vi } from "vitest";
import { LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY } from "./livekit-recording-duration-policy.server";
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
    uploadAuthorizationPolicy:
      LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY,
    authorizeUpload: vi.fn().mockResolvedValue({
      accessKeyId: "temporary-access-key",
      secretAccessKey: "temporary-secret-key",
      sessionToken: "temporary-session-token",
      expiresAt,
    }),
  };
}

function recordingRequest(
  input: {
    roomName?: string;
    storageObjectKey?: string;
    bucket?: string;
    region?: string;
    endpoint?: string;
    forcePathStyle?: boolean;
    includeStorage?: boolean;
    outputStorage?: StorageConfig;
  } = {},
): StartEgressRequest {
  const output = new Output({
    config: {
      case: "file",
      value: new FileOutput({
        fileType: EncodedFileType.MP4,
        filepath: input.storageObjectKey ?? startInput.storageObjectKey,
        disableManifest: true,
      }),
    },
    ...(input.outputStorage ? { storage: input.outputStorage } : {}),
  });
  return new StartEgressRequest({
    roomName: input.roomName ?? startInput.roomName,
    source: {
      case: "template",
      value: new TemplateSource({ layout: "speaker" }),
    },
    outputs: [output],
    ...(input.includeStorage === false
      ? {}
      : {
          storage: new StorageConfig({
            provider: {
              case: "s3",
              value: new S3Upload({
                region: input.region ?? configuration.region,
                bucket: input.bucket ?? configuration.bucket,
                ...(input.endpoint === undefined
                  ? {}
                  : { endpoint: input.endpoint }),
                ...(input.forcePathStyle === undefined
                  ? {}
                  : { forcePathStyle: input.forcePathStyle }),
              }),
            },
          }),
        }),
  });
}

describe("LiveKit Cloud recording provider", () => {
  it("starts managed speaker-layout MP4 Egress with an exact private upload target", async () => {
    let request: StartEgressRequest | undefined;
    let authorizationRequest: unknown;
    const authorizer: LiveKitRecordingUploadAuthorizer = {
      uploadAuthorizationPolicy:
        LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY,
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

    const prepared = await provider.prepareRoomCompositeRecording(startInput);
    expect(egress.startEgress).not.toHaveBeenCalled();
    await expect(prepared.dispatch()).resolves.toMatchObject({
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

  it("rejects a start response for a different valid output key", async () => {
    const egress = {
      startEgress: vi.fn().mockResolvedValue(
        new EgressInfo({
          egressId: "EG_recording_1",
          roomName: startInput.roomName,
          status: EgressStatus.EGRESS_STARTING,
          request: {
            case: "egress",
            value: recordingRequest({
              storageObjectKey: "recordings/other_room/other_recording.mp4",
            }),
          },
        }),
      ),
      listEgress: vi.fn(),
      stopEgress: vi.fn(),
    };
    const provider = new LiveKitCloudRecordingProvider(
      configuration,
      uploadAuthorizer(),
      egress,
      now,
    );

    const prepared = await provider.prepareRoomCompositeRecording(startInput);
    await expect(prepared.dispatch()).rejects.toBeInstanceOf(
      LiveKitRecordingProviderError,
    );
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
      .prepareRoomCompositeRecording(startInput)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LiveKitRecordingProviderError);
    expect(String(failure)).not.toContain("temporary");
    expect(egress.startEgress).not.toHaveBeenCalled();
  });

  it("rechecks upload authorization expiry after authorization completes", async () => {
    const egress = {
      startEgress: vi.fn(),
      listEgress: vi.fn(),
      stopEgress: vi.fn(),
    };
    const clock = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2030-09-03T23:00:00.000Z"))
      .mockReturnValueOnce(new Date("2030-09-04T02:00:00.000Z"));
    const provider = new LiveKitCloudRecordingProvider(
      configuration,
      uploadAuthorizer(new Date("2030-09-04T02:00:00.000Z")),
      egress,
      clock,
    );

    await expect(
      provider.prepareRoomCompositeRecording(startInput),
    ).rejects.toBeInstanceOf(LiveKitRecordingProviderError);
    expect(clock).toHaveBeenCalledTimes(2);
    expect(egress.startEgress).not.toHaveBeenCalled();
  });

  it("normalises active, complete and bounded provider failure states", async () => {
    const startedAt = providerNanoseconds("2030-09-03T23:32:00.000Z");
    const endedAt = providerNanoseconds("2030-09-04T00:32:00.000Z");
    const request = recordingRequest();
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
        storageObjectKey: startInput.storageObjectKey,
        status: "active",
        startedAt: new Date("2030-09-03T23:32:00.000Z"),
        endedAt: null,
        output: null,
        failureCode: null,
      },
      {
        providerEgressId: "EG_complete",
        roomName: startInput.roomName,
        storageObjectKey: startInput.storageObjectKey,
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
        storageObjectKey: startInput.storageObjectKey,
        status: "failed",
        startedAt: null,
        endedAt: null,
        output: null,
        failureCode: "provider_failed",
      },
    ]);
  });

  it.each([
    ["missing request storage", recordingRequest({ includeStorage: false })],
    [
      "a different bucket",
      recordingRequest({ bucket: "other-private-recordings" }),
    ],
    ["a different region", recordingRequest({ region: "us-east-1" })],
    [
      "a custom S3 endpoint",
      recordingRequest({ endpoint: "https://storage.invalid" }),
    ],
    ["path-style S3 routing", recordingRequest({ forcePathStyle: true })],
    [
      "a malformed nonterminal filepath",
      recordingRequest({ storageObjectKey: "other/recording.mp4" }),
    ],
    [
      "an output-level storage override",
      recordingRequest({
        outputStorage: new StorageConfig({
          provider: {
            case: "s3",
            value: new S3Upload({
              region: configuration.region,
              bucket: "other-private-recordings",
            }),
          },
        }),
      }),
    ],
  ])("rejects provider evidence with %s", async (_name, request) => {
    const egress = {
      startEgress: vi.fn(),
      listEgress: vi.fn().mockResolvedValue([
        new EgressInfo({
          egressId: "EG_recording_1",
          roomName: startInput.roomName,
          status: EgressStatus.EGRESS_STARTING,
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
    ).rejects.toBeInstanceOf(LiveKitRecordingProviderError);
  });

  it("looks up one known Egress without inspecting unrelated room jobs", async () => {
    const request = recordingRequest();
    const exact = new EgressInfo({
      egressId: "EG_recording_1",
      roomName: startInput.roomName,
      status: EgressStatus.EGRESS_ACTIVE,
      startedAt: providerNanoseconds("2030-09-03T23:32:00.000Z"),
      request: { case: "egress", value: request },
    });
    const egress = {
      startEgress: vi.fn(),
      listEgress: vi.fn().mockImplementation((input: { egressId?: string }) => {
        if (input.egressId === exact.egressId) return Promise.resolve([exact]);
        throw new Error("Room-wide listing inspected unrelated Egress jobs");
      }),
      stopEgress: vi.fn(),
    };
    const provider = new LiveKitCloudRecordingProvider(
      configuration,
      uploadAuthorizer(),
      egress,
      now,
    );

    await expect(
      provider.getRoomCompositeRecording({
        roomName: startInput.roomName,
        providerEgressId: exact.egressId,
        storageObjectKey: startInput.storageObjectKey,
      }),
    ).resolves.toMatchObject({
      providerEgressId: exact.egressId,
      roomName: startInput.roomName,
      storageObjectKey: startInput.storageObjectKey,
      status: "active",
    });
    expect(egress.listEgress).toHaveBeenCalledTimes(1);
    expect(egress.listEgress).toHaveBeenCalledWith({
      egressId: exact.egressId,
    });
  });

  it.each([
    ["room", "other_room", "EG_recording_1", startInput.storageObjectKey],
    [
      "Egress identifier",
      startInput.roomName,
      "EG_other_recording",
      startInput.storageObjectKey,
    ],
    [
      "storage object",
      startInput.roomName,
      "EG_recording_1",
      "recordings/opaque_room/other_recording.mp4",
    ],
  ])(
    "verifies exact %s ownership before stopping an Egress",
    async (
      _target,
      providerRoomName,
      providerEgressId,
      providerStorageObjectKey,
    ) => {
      const request = recordingRequest({
        roomName: providerRoomName,
        storageObjectKey: providerStorageObjectKey,
      });
      const egress = {
        startEgress: vi.fn(),
        listEgress: vi.fn().mockResolvedValue([
          new EgressInfo({
            egressId: providerEgressId,
            roomName: providerRoomName,
            status: EgressStatus.EGRESS_ACTIVE,
            startedAt: providerNanoseconds("2030-09-03T23:32:00.000Z"),
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

      const failure = await provider
        .stopRoomCompositeRecording({
          roomName: startInput.roomName,
          providerEgressId: "EG_recording_1",
          storageObjectKey: startInput.storageObjectKey,
        })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(LiveKitRecordingProviderError);
      expect(egress.listEgress).toHaveBeenCalledWith({
        egressId: "EG_recording_1",
      });
      expect(egress.stopEgress).not.toHaveBeenCalled();
    },
  );

  it("requires one provider match before stopping an Egress", async () => {
    const egress = {
      startEgress: vi.fn(),
      listEgress: vi.fn().mockResolvedValue([]),
      stopEgress: vi.fn(),
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
        storageObjectKey: startInput.storageObjectKey,
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LiveKitRecordingProviderError);
    expect(egress.listEgress).toHaveBeenCalledWith({
      egressId: "EG_recording_1",
    });
    expect(egress.stopEgress).not.toHaveBeenCalled();
  });

  it("stops only the exact Egress resolved before the destructive call", async () => {
    const request = recordingRequest();
    const existing = new EgressInfo({
      egressId: "EG_recording_1",
      roomName: startInput.roomName,
      status: EgressStatus.EGRESS_ACTIVE,
      startedAt: providerNanoseconds("2030-09-03T23:32:00.000Z"),
      request: { case: "egress", value: request },
    });
    const egress = {
      startEgress: vi.fn(),
      listEgress: vi.fn().mockResolvedValue([existing]),
      stopEgress: vi.fn().mockResolvedValue(
        new EgressInfo({
          egressId: "EG_recording_1",
          roomName: startInput.roomName,
          status: EgressStatus.EGRESS_ENDING,
          startedAt: providerNanoseconds("2030-09-03T23:32:00.000Z"),
          request: { case: "egress", value: request },
        }),
      ),
    };
    const provider = new LiveKitCloudRecordingProvider(
      configuration,
      uploadAuthorizer(),
      egress,
      now,
    );

    await expect(
      provider.stopRoomCompositeRecording({
        roomName: startInput.roomName,
        providerEgressId: "EG_recording_1",
        storageObjectKey: startInput.storageObjectKey,
      }),
    ).resolves.toMatchObject({
      providerEgressId: "EG_recording_1",
      roomName: startInput.roomName,
      status: "stopping",
    });
    expect(egress.listEgress).toHaveBeenCalledWith({
      egressId: "EG_recording_1",
    });
    expect(egress.stopEgress).toHaveBeenCalledWith("EG_recording_1");
  });
});
