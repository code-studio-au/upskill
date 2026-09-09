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
import type { LiveKitRecordingUploadAuthorizationPolicy } from "./livekit-recording-duration-policy.server";
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

export interface LiveKitRecordingUploadAuthorizationRequest {
  bucket: string;
  region: string;
  storageObjectKey: string;
  requiredUntil: Date;
}

export interface LiveKitRecordingUploadAuthorization {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: Date;
}

export interface LiveKitRecordingUploadAuthorizer {
  readonly uploadAuthorizationPolicy: LiveKitRecordingUploadAuthorizationPolicy;
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

export type LiveKitRecordingStorageConfiguration = Pick<
  LiveKitCloudRecordingConfiguration,
  "region" | "bucket"
>;

interface LiveKitEgressClient {
  startEgress(request: StartEgressRequest): Promise<EgressInfo>;
  listEgress(options: {
    roomName?: string;
    egressId?: string;
  }): Promise<EgressInfo[]>;
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

function validatedFileOutput(
  info: EgressInfo,
  expectedRoomName: string,
  configuration: LiveKitRecordingStorageConfiguration,
  expectedEgressId?: string,
  expectedStorageObjectKey?: string,
): FileOutput {
  if (
    info.roomName !== expectedRoomName ||
    (expectedEgressId !== undefined && info.egressId !== expectedEgressId)
  )
    throw new TypeError("Provider recording target mismatch");
  if (info.request.case !== "egress")
    throw new TypeError("Provider recording did not use StartEgress");
  const request = info.request.value;
  const output = request.outputs[0];
  const storage = request.storage;
  if (
    request.roomName !== expectedRoomName ||
    request.source.case !== "template" ||
    request.source.value.layout !== "speaker" ||
    request.source.value.audioOnly ||
    request.source.value.videoOnly ||
    request.source.value.customBaseUrl !== "" ||
    request.outputs.length !== 1 ||
    output?.config.case !== "file" ||
    output.config.value.fileType !== EncodedFileType.MP4 ||
    !output.config.value.disableManifest ||
    output.storage !== undefined ||
    storage?.provider.case !== "s3" ||
    storage.provider.value.bucket !== configuration.bucket ||
    storage.provider.value.region !== configuration.region ||
    storage.provider.value.endpoint !== "" ||
    storage.provider.value.forcePathStyle
  )
    throw new TypeError("Provider recording does not match the fixed contract");
  const storageObjectKey = parseLiveKitRecordingStorageObjectKey(
    output.config.value.filepath,
  );
  if (
    expectedStorageObjectKey !== undefined &&
    storageObjectKey !== expectedStorageObjectKey
  )
    throw new TypeError("Provider recording output path mismatch");
  return output.config.value;
}

export function normalizeLiveKitRecordingEgressInfo(
  info: EgressInfo,
  expectedRoomName: string,
  configuration: LiveKitRecordingStorageConfiguration,
  expectedEgressId?: string,
  expectedStorageObjectKey?: string,
): LiveKitRecordingSnapshot {
  const fileOutput = validatedFileOutput(
    info,
    expectedRoomName,
    configuration,
    expectedEgressId,
    expectedStorageObjectKey,
  );
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
    storageObjectKey: fileOutput.filepath,
    status,
    startedAt,
    endedAt,
    output,
    failureCode,
  });
}

function targetsStorageObjectKey(
  info: EgressInfo,
  storageObjectKey: string,
): boolean {
  if (info.request.case !== "egress") return false;
  return info.request.value.outputs.some(
    (output) =>
      output.config.case === "file" &&
      output.config.value.filepath === storageObjectKey,
  );
}

export class LiveKitCloudRecordingProvider implements LiveKitRecordingProvider {
  readonly uploadAuthorizationPolicy: LiveKitRecordingUploadAuthorizationPolicy;
  private readonly configuration: LiveKitCloudRecordingConfiguration;
  private readonly egress: LiveKitEgressClient;

  constructor(
    configuration: LiveKitCloudRecordingConfiguration,
    private readonly uploadAuthorizer: LiveKitRecordingUploadAuthorizer,
    egress?: LiveKitEgressClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.configuration = recordingConfigurationSchema.parse(configuration);
    this.uploadAuthorizationPolicy = uploadAuthorizer.uploadAuthorizationPolicy;
    this.egress =
      egress ??
      new LiveKitAPI({
        host: this.configuration.url,
        apiKey: this.configuration.apiKey,
        secret: this.configuration.apiSecret,
      }).egress;
  }

  async prepareRoomCompositeRecording(
    input: StartLiveKitRoomCompositeRecordingInput,
  ): Promise<PreparedLiveKitRoomCompositeRecording> {
    const parsed = parseStartLiveKitRoomCompositeRecordingInput(input);
    let request: StartEgressRequest;
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
      request = new StartEgressRequest({
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
    } catch {
      throw new LiveKitRecordingProviderError("prepare_recording");
    }
    let dispatched = false;
    return {
      dispatch: async () => {
        if (dispatched)
          throw new LiveKitRecordingProviderError("start_recording");
        dispatched = true;
        try {
          return normalizeLiveKitRecordingEgressInfo(
            await this.egress.startEgress(request),
            parsed.roomName,
            this.configuration,
            undefined,
            parsed.storageObjectKey,
          );
        } catch {
          throw new LiveKitRecordingProviderError("start_recording");
        }
      },
    };
  }

  async listRoomCompositeRecordings(
    roomName: string,
    storageObjectKey: string,
  ): Promise<LiveKitRecordingSnapshot[]> {
    const parsedRoomName = parseLiveKitRecordingRoomName(roomName);
    const parsedStorageObjectKey =
      parseLiveKitRecordingStorageObjectKey(storageObjectKey);
    try {
      return (
        await this.egress.listEgress({ roomName: parsedRoomName })
      ).flatMap((info) =>
        targetsStorageObjectKey(info, parsedStorageObjectKey)
          ? [
              normalizeLiveKitRecordingEgressInfo(
                info,
                parsedRoomName,
                this.configuration,
                undefined,
                parsedStorageObjectKey,
              ),
            ]
          : [],
      );
    } catch {
      throw new LiveKitRecordingProviderError("list_recordings");
    }
  }

  async getRoomCompositeRecording(
    target: LiveKitRecordingTarget,
  ): Promise<LiveKitRecordingSnapshot | null> {
    const parsed = parseLiveKitRecordingTarget(target);
    try {
      const matches = await this.egress.listEgress({
        egressId: parsed.providerEgressId,
      });
      if (matches.length === 0) return null;
      const [existing] = matches;
      if (!existing || matches.length !== 1)
        throw new TypeError("Provider recording lookup was not exact");
      return normalizeLiveKitRecordingEgressInfo(
        existing,
        parsed.roomName,
        this.configuration,
        parsed.providerEgressId,
        parsed.storageObjectKey,
      );
    } catch {
      throw new LiveKitRecordingProviderError("get_recording");
    }
  }

  async stopRoomCompositeRecording(
    target: LiveKitRecordingTarget,
  ): Promise<LiveKitRecordingSnapshot> {
    const parsed = parseLiveKitRecordingTarget(target);
    try {
      const matches = await this.egress.listEgress({
        egressId: parsed.providerEgressId,
      });
      const [existing] = matches;
      if (!existing || matches.length !== 1)
        throw new TypeError("Provider recording lookup was not exact");
      const fileOutput = validatedFileOutput(
        existing,
        parsed.roomName,
        this.configuration,
        parsed.providerEgressId,
        parsed.storageObjectKey,
      );
      return normalizeLiveKitRecordingEgressInfo(
        await this.egress.stopEgress(parsed.providerEgressId),
        parsed.roomName,
        this.configuration,
        parsed.providerEgressId,
        fileOutput.filepath,
      );
    } catch {
      throw new LiveKitRecordingProviderError("stop_recording");
    }
  }
}
