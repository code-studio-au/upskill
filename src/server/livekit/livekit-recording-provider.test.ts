import { describe, expect, it } from "vitest";
import { FakeLiveKitRecordingProvider } from "./livekit-recording-provider.fake";
import {
  LiveKitRecordingProviderError,
  parseLiveKitRecordingSnapshot,
  parseStartLiveKitRoomCompositeRecordingInput,
} from "./livekit-recording-provider.server";

const startInput = {
  roomName: "room_generation_1",
  storageObjectKey: "recordings/opaque_room/opaque_recording.mp4",
  uploadAuthorizationExpiresAt: new Date("2030-09-04T01:00:00.000Z"),
  layout: "speaker" as const,
  format: "mp4" as const,
};

describe("LiveKit recording provider contract", () => {
  it("accepts only the fixed composite MP4 contract and opaque output keys", () => {
    expect(parseStartLiveKitRoomCompositeRecordingInput(startInput)).toEqual(
      startInput,
    );
    expect(() =>
      parseStartLiveKitRoomCompositeRecordingInput({
        ...startInput,
        storageObjectKey: "../public/learner@example.com.mp4",
      }),
    ).toThrow();
    expect(() =>
      parseStartLiveKitRoomCompositeRecordingInput({
        ...startInput,
        storageObjectKey: "recordings/opaque_room/.mp4",
      }),
    ).toThrow();
    expect(() =>
      parseStartLiveKitRoomCompositeRecordingInput({
        ...startInput,
        layout: "custom-template",
      }),
    ).toThrow();
  });

  it("rejects raw provider failure details from normalised snapshots", () => {
    expect(() =>
      parseLiveKitRecordingSnapshot({
        providerEgressId: "EG_1",
        roomName: "room_generation_1",
        status: "failed",
        startedAt: null,
        endedAt: null,
        output: null,
        failureCode: "provider leaked a credential",
      }),
    ).toThrow();
  });

  it.each([
    [
      "active without provider start evidence",
      {
        status: "active",
        startedAt: null,
        endedAt: null,
        output: null,
        failureCode: null,
      },
    ],
    [
      "complete without output evidence",
      {
        status: "complete",
        startedAt: new Date("2030-09-03T23:32:00.000Z"),
        endedAt: new Date("2030-09-04T00:32:00.000Z"),
        output: null,
        failureCode: null,
      },
    ],
    [
      "failure without a safe code",
      {
        status: "failed",
        startedAt: null,
        endedAt: null,
        output: null,
        failureCode: null,
      },
    ],
    [
      "failed state with completed output metadata",
      {
        status: "failed",
        startedAt: new Date("2030-09-03T23:32:00.000Z"),
        endedAt: new Date("2030-09-04T00:32:00.000Z"),
        output: {
          storageObjectKey: startInput.storageObjectKey,
          fileSizeBytes: 1_048_576n,
          durationNanoseconds: 3_600_000_000_000n,
        },
        failureCode: "provider_failed",
      },
    ],
  ])("rejects %s", (_name, state) => {
    expect(() =>
      parseLiveKitRecordingSnapshot({
        providerEgressId: "EG_1",
        roomName: "room_generation_1",
        ...state,
      }),
    ).toThrow();
  });

  it("provides deterministic start, inspection and stop operations", async () => {
    const provider = new FakeLiveKitRecordingProvider();
    const started = await provider.startRoomCompositeRecording(startInput);
    expect(started).toMatchObject({
      providerEgressId: "EG_FAKE_1",
      roomName: startInput.roomName,
      status: "starting",
    });
    await expect(
      provider.listRoomCompositeRecordings(startInput.roomName),
    ).resolves.toEqual([started]);
    await expect(
      provider.stopRoomCompositeRecording({
        roomName: startInput.roomName,
        providerEgressId: started.providerEgressId,
      }),
    ).resolves.toMatchObject({ status: "stopping" });
    expect(provider.operations.map(({ operation }) => operation)).toEqual([
      "start_recording",
      "list_recordings",
      "stop_recording",
    ]);
  });

  it("does not stop an Egress job outside the expected room", async () => {
    const provider = new FakeLiveKitRecordingProvider();
    const started = await provider.startRoomCompositeRecording(startInput);
    const failure = await provider
      .stopRoomCompositeRecording({
        roomName: "other_room_generation",
        providerEgressId: started.providerEgressId,
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LiveKitRecordingProviderError);
    expect(String(failure)).toBe(
      "LiveKitRecordingProviderError: LiveKit recording provider operation failed: stop_recording",
    );
  });
});
