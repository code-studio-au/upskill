import "@tanstack/react-start/server-only";

import {
  LiveKitRecordingProviderError,
  parseLiveKitRecordingRoomName,
  parseLiveKitRecordingSnapshot,
  parseLiveKitRecordingTarget,
  parseStartLiveKitRoomCompositeRecordingInput,
  type LiveKitRecordingProvider,
  type LiveKitRecordingSnapshot,
  type LiveKitRecordingTarget,
  type StartLiveKitRoomCompositeRecordingInput,
} from "./livekit-recording-provider.server";

export type FakeLiveKitRecordingOperation =
  | {
      operation: "start_recording";
      input: StartLiveKitRoomCompositeRecordingInput;
    }
  | { operation: "list_recordings"; roomName: string }
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

  startRoomCompositeRecording(
    input: StartLiveKitRoomCompositeRecordingInput,
  ): Promise<LiveKitRecordingSnapshot> {
    const parsed = parseStartLiveKitRoomCompositeRecordingInput(input);
    this.operations.push({ operation: "start_recording", input: parsed });
    const providerEgressId = `EG_FAKE_${String(this.recordings.size + 1)}`;
    const snapshot = parseLiveKitRecordingSnapshot({
      providerEgressId,
      roomName: parsed.roomName,
      status: "starting",
      startedAt: null,
      endedAt: null,
      output: null,
      failureCode: null,
    });
    this.recordings.set(providerEgressId, snapshot);
    return Promise.resolve(cloneSnapshot(snapshot));
  }

  listRoomCompositeRecordings(
    roomName: string,
  ): Promise<LiveKitRecordingSnapshot[]> {
    const parsedRoomName = parseLiveKitRecordingRoomName(roomName);
    this.operations.push({
      operation: "list_recordings",
      roomName: parsedRoomName,
    });
    return Promise.resolve(
      [...this.recordings.values()]
        .filter((recording) => recording.roomName === parsedRoomName)
        .map(cloneSnapshot),
    );
  }

  stopRoomCompositeRecording(
    target: LiveKitRecordingTarget,
  ): Promise<LiveKitRecordingSnapshot> {
    const parsed = parseLiveKitRecordingTarget(target);
    this.operations.push({ operation: "stop_recording", target: parsed });
    const current = this.recordings.get(parsed.providerEgressId);
    if (!current || current.roomName !== parsed.roomName)
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
