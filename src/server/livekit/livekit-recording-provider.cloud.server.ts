import "@tanstack/react-start/server-only";

import {
  EgressStatus,
  EncodedFileType,
  FileOutput,
  LiveKitAPI,
  Output,
  S3Upload,
  StartEgressRequest,
  StorageConfig,
  TemplateSource,
  type EgressInfo,
} from "livekit-server-sdk";
import { z } from "#/validation/zod.server";
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

const s3BucketSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u)
  .refine((value) => !value.includes(".."));

const recordingConfigurationSchema = z.object({
  url: z.url(),
  apiKey: z.string().min(1).max(200),
  apiSecret: z.string().min(32).max(500),
  region: z.string().min(1).max(100),
  bucket: s3BucketSchema,
});

const uploadAuthorizationSchema = z.object({
  accessKeyId: z.string().min(1).max(128),
  secretAccessKey: z.string().min(1).max(256),
  sessionToken: z.string().min(1).max(4_096),
  expiresAt: z.date(),
});

interface LiveKitRecordingUploadAuthorizationRequest {
  bucket: string;
  region: string;
  storageObjectKey: string;
  requiredUntil: Date;
}

interface LiveKitRecordingUploadAuthorization {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: Date;
}

export interface LiveKitRecordingUploadAuthorizer {
  authorizeUpload(
    request: LiveKitRecordingUploadAuthorizationRequest,
  ): Promise<LiveKitRecordingUploadAuthorization>;
}

export interface LiveKitCloudRecordingConfiguration {
  url: string;
  apiKey: string;
  apiSecret: string;
  region: string;
  bucket: string;
}

interface LiveKitEgressClient {
  startEgress(request: StartEgressRequest): Promise<EgressInfo>;
  listEgress(options: { roomName: string }): Promise<EgressInfo[]>;
  stopEgress(egressId: string): Promise<EgressInfo>;
}

function dateFromProviderNanoseconds(value: bigint): Date | null {
  if (value === 0n) return null;
  const milliseconds = value / 1_000_000n;
  if (milliseconds > 8_640_000_000_000_000n || milliseconds < 0n)
    throw new RangeError("Provider recording timestamp is outside Date range");
  const date = new Date(Number(milliseconds));
  if (Number.isNaN(date.getTime()))
    throw new RangeError("Provider recording timestamp is invalid");
  return date;
}

function requestedFileOutput(info: EgressInfo): FileOutput {
  if (info.request.case !== "egress")
    throw new TypeError("Provider recording did not use StartEgress");
  const request = info.request.value;
  if (
    request.source.case !== "template" ||
    request.source.value.layout !== "speaker" ||
    request.source.value.audioOnly ||
    request.source.value.videoOnly ||
    request.source.value.customBaseUrl !== "" ||
    request.outputs.length !== 1 ||
    request.outputs[0]?.config.case !== "file" ||
    request.outputs[0].config.value.fileType !== EncodedFileType.MP4 ||
    !request.outputs[0].config.value.disableManifest
  )
    throw new TypeError("Provider recording does not match the fixed contract");
  return request.outputs[0].config.value;
}

function recordingSnapshot(
  info: EgressInfo,
  expectedRoomName: string,
  expectedEgressId?: string,
): LiveKitRecordingSnapshot {
  if (
    info.roomName !== expectedRoomName ||
    (expectedEgressId && info.egressId !== expectedEgressId)
  )
    throw new TypeError("Provider recording target mismatch");
  const fileOutput = requestedFileOutput(info);
  const startedAt = dateFromProviderNanoseconds(info.startedAt);
  const endedAt = dateFromProviderNanoseconds(info.endedAt);
  let failureCode: string | null = null;
  let status: LiveKitRecordingSnapshot["status"];
  switch (info.status) {
    case EgressStatus.EGRESS_STARTING:
      status = "starting";
      break;
    case EgressStatus.EGRESS_ACTIVE:
      status = "active";
      break;
    case EgressStatus.EGRESS_ENDING:
      status = "stopping";
      break;
    case EgressStatus.EGRESS_COMPLETE:
      status = "complete";
      break;
    case EgressStatus.EGRESS_FAILED:
      status = "failed";
      failureCode = "provider_failed";
      break;
    case EgressStatus.EGRESS_ABORTED:
      status = "failed";
      failureCode = "provider_aborted";
      break;
    case EgressStatus.EGRESS_LIMIT_REACHED:
      status = "failed";
      failureCode = "provider_limit_reached";
      break;
  }
  let output: LiveKitRecordingSnapshot["output"] = null;
  if (status === "complete") {
    const [file] = info.fileResults;
    if (!file || info.fileResults.length !== 1)
      throw new TypeError("Completed provider recording has invalid output");
    if (file.filename !== fileOutput.filepath)
      throw new TypeError("Provider recording output path mismatch");
    output = {
      storageObjectKey: file.filename,
      fileSizeBytes: file.size,
      durationNanoseconds: file.duration,
    };
  }
  return parseLiveKitRecordingSnapshot({
    providerEgressId: info.egressId,
    roomName: info.roomName,
    status,
    startedAt,
    endedAt,
    output,
    failureCode,
  });
}

export class LiveKitCloudRecordingProvider implements LiveKitRecordingProvider {
  private readonly configuration: LiveKitCloudRecordingConfiguration;
  private readonly egress: LiveKitEgressClient;

  constructor(
    configuration: LiveKitCloudRecordingConfiguration,
    private readonly uploadAuthorizer: LiveKitRecordingUploadAuthorizer,
    egress?: LiveKitEgressClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.configuration = recordingConfigurationSchema.parse(configuration);
    this.egress =
      egress ??
      new LiveKitAPI({
        host: this.configuration.url,
        apiKey: this.configuration.apiKey,
        secret: this.configuration.apiSecret,
      }).egress;
  }

  async startRoomCompositeRecording(
    input: StartLiveKitRoomCompositeRecordingInput,
  ): Promise<LiveKitRecordingSnapshot> {
    const parsed = parseStartLiveKitRoomCompositeRecordingInput(input);
    try {
      const now = this.now();
      if (parsed.uploadAuthorizationExpiresAt <= now)
        throw new RangeError(
          "Recording upload authorization must cover a future interval",
        );
      const authorization = uploadAuthorizationSchema.parse(
        await this.uploadAuthorizer.authorizeUpload({
          bucket: this.configuration.bucket,
          region: this.configuration.region,
          storageObjectKey: parsed.storageObjectKey,
          requiredUntil: parsed.uploadAuthorizationExpiresAt,
        }),
      );
      const authorizationCheckedAt = this.now();
      if (
        authorization.expiresAt <= authorizationCheckedAt ||
        authorization.expiresAt < parsed.uploadAuthorizationExpiresAt
      )
        throw new RangeError(
          "Recording upload authorization expires before the required time",
        );
      const request = new StartEgressRequest({
        roomName: parsed.roomName,
        source: {
          case: "template",
          value: new TemplateSource({ layout: parsed.layout }),
        },
        outputs: [
          new Output({
            config: {
              case: "file",
              value: new FileOutput({
                fileType: EncodedFileType.MP4,
                filepath: parsed.storageObjectKey,
                disableManifest: true,
              }),
            },
          }),
        ],
        storage: new StorageConfig({
          provider: {
            case: "s3",
            value: new S3Upload({
              accessKey: authorization.accessKeyId,
              secret: authorization.secretAccessKey,
              sessionToken: authorization.sessionToken,
              region: this.configuration.region,
              bucket: this.configuration.bucket,
            }),
          },
        }),
      });
      return recordingSnapshot(
        await this.egress.startEgress(request),
        parsed.roomName,
      );
    } catch {
      throw new LiveKitRecordingProviderError("start_recording");
    }
  }

  async listRoomCompositeRecordings(
    roomName: string,
  ): Promise<LiveKitRecordingSnapshot[]> {
    const parsedRoomName = parseLiveKitRecordingRoomName(roomName);
    try {
      return (await this.egress.listEgress({ roomName: parsedRoomName })).map(
        (info) => recordingSnapshot(info, parsedRoomName),
      );
    } catch {
      throw new LiveKitRecordingProviderError("list_recordings");
    }
  }

  async stopRoomCompositeRecording(
    target: LiveKitRecordingTarget,
  ): Promise<LiveKitRecordingSnapshot> {
    const parsed = parseLiveKitRecordingTarget(target);
    try {
      return recordingSnapshot(
        await this.egress.stopEgress(parsed.providerEgressId),
        parsed.roomName,
        parsed.providerEgressId,
      );
    } catch {
      throw new LiveKitRecordingProviderError("stop_recording");
    }
  }
}
