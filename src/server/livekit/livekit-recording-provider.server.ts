import "@tanstack/react-start/server-only";

import { z } from "#/validation/zod.server";
import type { LiveKitRecordingUploadAuthorizationPolicy } from "./livekit-recording-duration-policy.server";

const roomNameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9:_-]+$/u);
const providerEgressIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/u);
const storageObjectKeySchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^recordings\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*[.]mp4$/u);

const startRoomCompositeRecordingInputSchema = z.object({
  roomName: roomNameSchema,
  storageObjectKey: storageObjectKeySchema,
  uploadAuthorizationExpiresAt: z.date(),
  layout: z.literal("speaker"),
  format: z.literal("mp4"),
});

const recordingTargetSchema = z.object({
  roomName: roomNameSchema,
  providerEgressId: providerEgressIdSchema,
  storageObjectKey: storageObjectKeySchema,
});

const recordingOutputSchema = z.object({
  storageObjectKey: storageObjectKeySchema,
  fileSizeBytes: z.bigint().min(0n),
  durationNanoseconds: z.bigint().min(0n),
});

const liveKitRecordingSnapshotSchema = z
  .object({
    providerEgressId: providerEgressIdSchema,
    roomName: roomNameSchema,
    storageObjectKey: storageObjectKeySchema,
    status: z.enum(["starting", "active", "stopping", "complete", "failed"]),
    startedAt: z.date().nullable(),
    endedAt: z.date().nullable(),
    output: recordingOutputSchema.nullable(),
    failureCode: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9_]+$/u)
      .nullable(),
  })
  .check(
    z.superRefine((snapshot, context) => {
      const issue = (path: string, message: string) => {
        context.addIssue({ code: "custom", path: [path], message });
      };
      if (snapshot.status === "complete") {
        if (!snapshot.startedAt)
          issue("startedAt", "Completed recordings require a start time.");
        if (!snapshot.endedAt)
          issue("endedAt", "Completed recordings require an end time.");
        if (!snapshot.output)
          issue("output", "Completed recordings require output evidence.");
        if (
          snapshot.output &&
          snapshot.output.storageObjectKey !== snapshot.storageObjectKey
        )
          issue("output", "Completed output must match the recording target.");
      } else if (snapshot.status !== "failed" && snapshot.output) {
        issue("output", "Output evidence is terminal recording state.");
      }
      if (snapshot.status === "failed") {
        if (!snapshot.failureCode)
          issue("failureCode", "Failed recordings require a safe reason code.");
        if (snapshot.output)
          issue("output", "Failed recordings cannot carry completed output.");
      } else if (snapshot.failureCode) {
        issue("failureCode", "Only failed recordings carry a failure code.");
      }
      if (snapshot.status === "active" && !snapshot.startedAt)
        issue("startedAt", "Active recordings require a start time.");
      if (
        snapshot.status !== "complete" &&
        snapshot.status !== "failed" &&
        snapshot.endedAt
      )
        issue("endedAt", "Only terminal recordings carry an end time.");
      if (
        snapshot.startedAt &&
        snapshot.endedAt &&
        snapshot.endedAt < snapshot.startedAt
      )
        issue("endedAt", "Recording end time cannot precede its start time.");
    }),
  );

export type StartLiveKitRoomCompositeRecordingInput = z.infer<
  typeof startRoomCompositeRecordingInputSchema
>;
export type LiveKitRecordingTarget = z.infer<typeof recordingTargetSchema>;
export type LiveKitRecordingSnapshot = z.infer<
  typeof liveKitRecordingSnapshotSchema
>;

export interface PreparedLiveKitRoomCompositeRecording {
  dispatch(): Promise<LiveKitRecordingSnapshot>;
}

export interface LiveKitRecordingProvider {
  readonly uploadAuthorizationPolicy: LiveKitRecordingUploadAuthorizationPolicy;
  prepareRoomCompositeRecording(
    input: StartLiveKitRoomCompositeRecordingInput,
  ): Promise<PreparedLiveKitRoomCompositeRecording>;
  listRoomCompositeRecordings(
    roomName: string,
    storageObjectKey: string,
  ): Promise<LiveKitRecordingSnapshot[]>;
  getRoomCompositeRecording(
    target: LiveKitRecordingTarget,
  ): Promise<LiveKitRecordingSnapshot | null>;
  stopRoomCompositeRecording(
    target: LiveKitRecordingTarget,
  ): Promise<LiveKitRecordingSnapshot>;
}

export type LiveKitRecordingProviderOperation =
  | "prepare_recording"
  | "start_recording"
  | "list_recordings"
  | "get_recording"
  | "stop_recording";

export class LiveKitRecordingProviderError extends Error {
  readonly code = "LIVEKIT_RECORDING_PROVIDER_OPERATION_FAILED";

  constructor(readonly operation: LiveKitRecordingProviderOperation) {
    super(`LiveKit recording provider operation failed: ${operation}`);
    this.name = "LiveKitRecordingProviderError";
  }
}

export function parseStartLiveKitRoomCompositeRecordingInput(
  input: unknown,
): StartLiveKitRoomCompositeRecordingInput {
  return startRoomCompositeRecordingInputSchema.parse(input);
}

export function parseLiveKitRecordingTarget(
  input: unknown,
): LiveKitRecordingTarget {
  return recordingTargetSchema.parse(input);
}

export function parseLiveKitRecordingRoomName(input: unknown): string {
  return roomNameSchema.parse(input);
}

export function parseLiveKitRecordingStorageObjectKey(input: unknown): string {
  return storageObjectKeySchema.parse(input);
}

export function parseLiveKitRecordingSnapshot(
  input: unknown,
): LiveKitRecordingSnapshot {
  return liveKitRecordingSnapshotSchema.parse(input);
}
