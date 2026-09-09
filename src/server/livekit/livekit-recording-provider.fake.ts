import "@tanstack/react-start/server-only";

import {
  LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY,
  type LiveKitRecordingUploadAuthorizationPolicy,
} from "./livekit-recording-duration-policy.server";
import {
  LiveKitRecordingProviderError,
  parseLiveKitRecordingRoomName,
  parseLiveKitRecordingSnapshot,
  parseLiveKitRecordingStorageObjectKey,
  parseLiveKitRecordingTarget,
  parseStartLiveKitRoomCompositeRecordingInput,
  type LiveKitRecordingProvider,
  type LiveKitRecordingSnapshot,
  type LiveKitRecordingTarget,
  type PreparedLiveKitRoomCompositeRecording,
  type StartLiveKitRoomCompositeRecordingInput,
} from "./livekit-recording-provider.server";

export type FakeLiveKitRecordingOperation =
  | {
      operation: "start_recording";
      input: StartLiveKitRoomCompositeRecordingInput;
    }
  | {
      operation: "list_recordings";
      roomName: string;
      storageObjectKey: string;
    }
  | { operation: "get_recording"; target: LiveKitRecordingTarget }
  | { operation: "stop_recording"; target: LiveKitRecordingTarget };

function cloneSnapshot(
  snapshot: LiveKitRecordingSnapshot,
): LiveKitRecordingSnapshot {
  return {
    ...snapshot,
    startedAt: snapshot.startedAt ? new Date(snapshot.startedAt) : null,
    endedAt: snapshot.endedAt ? new Date(snapshot.endedAt) : null,
    output: snapshot.output ? { ...snapshot.output } : null,
  };
}

export class FakeLiveKitRecordingProvider implements LiveKitRecordingProvider {
  readonly operations: FakeLiveKitRecordingOperation[] = [];
  readonly recordings = new Map<string, LiveKitRecordingSnapshot>();

  constructor(
    readonly uploadAuthorizationPolicy: LiveKitRecordingUploadAuthorizationPolicy = LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY,
  ) {}

  prepareRoomCompositeRecording(
    input: StartLiveKitRoomCompositeRecordingInput,
  ): Promise<PreparedLiveKitRoomCompositeRecording> {
    const parsed = parseStartLiveKitRoomCompositeRecordingInput(input);
    let dispatched = false;
    return Promise.resolve({
      dispatch: () => {
        if (dispatched)
          return Promise.reject(
            new LiveKitRecordingProviderError("start_recording"),
          );
        dispatched = true;
        this.operations.push({ operation: "start_recording", input: parsed });
        const providerEgressId = `EG_FAKE_${String(this.recordings.size + 1)}`;
        const snapshot = parseLiveKitRecordingSnapshot({
          providerEgressId,
          roomName: parsed.roomName,
          storageObjectKey: parsed.storageObjectKey,
          status: "starting",
          startedAt: null,
          endedAt: null,
          output: null,
          failureCode: null,
        });
        this.recordings.set(providerEgressId, snapshot);
        return Promise.resolve(cloneSnapshot(snapshot));
      },
    });
  }

  listRoomCompositeRecordings(
    roomName: string,
    storageObjectKey: string,
  ): Promise<LiveKitRecordingSnapshot[]> {
    const parsedRoomName = parseLiveKitRecordingRoomName(roomName);
    const parsedStorageObjectKey =
      parseLiveKitRecordingStorageObjectKey(storageObjectKey);
    this.operations.push({
      operation: "list_recordings",
      roomName: parsedRoomName,
      storageObjectKey: parsedStorageObjectKey,
    });
    return Promise.resolve(
      [...this.recordings.values()]
        .filter(
          (recording) =>
            recording.roomName === parsedRoomName &&
            recording.storageObjectKey === parsedStorageObjectKey,
        )
        .map(cloneSnapshot),
    );
  }

  getRoomCompositeRecording(
    target: LiveKitRecordingTarget,
  ): Promise<LiveKitRecordingSnapshot | null> {
    const parsed = parseLiveKitRecordingTarget(target);
    this.operations.push({ operation: "get_recording", target: parsed });
    const current = this.recordings.get(parsed.providerEgressId);
    if (
      !current ||
      current.roomName !== parsed.roomName ||
      current.storageObjectKey !== parsed.storageObjectKey
    )
      return Promise.resolve(null);
    return Promise.resolve(cloneSnapshot(current));
  }

  stopRoomCompositeRecording(
    target: LiveKitRecordingTarget,
  ): Promise<LiveKitRecordingSnapshot> {
    const parsed = parseLiveKitRecordingTarget(target);
    this.operations.push({ operation: "stop_recording", target: parsed });
    const current = this.recordings.get(parsed.providerEgressId);
    if (
      !current ||
      current.roomName !== parsed.roomName ||
      current.storageObjectKey !== parsed.storageObjectKey
    )
      return Promise.reject(
        new LiveKitRecordingProviderError("stop_recording"),
      );
    if (current.status === "complete" || current.status === "failed")
      return Promise.resolve(cloneSnapshot(current));
    const stopping = parseLiveKitRecordingSnapshot({
      ...current,
      status: "stopping",
    });
    this.recordings.set(parsed.providerEgressId, stopping);
    return Promise.resolve(cloneSnapshot(stopping));
  }
}
