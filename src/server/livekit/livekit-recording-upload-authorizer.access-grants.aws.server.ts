import "@tanstack/react-start/server-only";

import {
  GetDataAccessCommand,
  Permission,
  Privilege,
  S3ControlClient,
  S3PrefixType,
  type GetDataAccessCommandOutput,
} from "@aws-sdk/client-s3-control";
import { z } from "#/validation/zod.server";
import {
  type LiveKitRecordingUploadAuthorization,
  type LiveKitRecordingUploadAuthorizationRequest,
  type LiveKitRecordingUploadAuthorizer,
} from "./livekit-recording-provider.cloud.server";
import { LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY } from "./livekit-recording-duration-policy.server";
import { parseLiveKitRecordingStorageObjectKey } from "./livekit-recording-provider.server";
import { LiveKitRecordingUploadAuthorizationError } from "./livekit-recording-upload-authorizer.aws.server";

const MINIMUM_ACCESS_GRANTS_SESSION_SECONDS = 15 * 60;
export const MAXIMUM_ACCESS_GRANTS_SESSION_SECONDS =
  LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY.maximumLifetimeMilliseconds /
  1_000;

const s3BucketSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u)
  .refine((value) => !value.includes(".."));
const awsRegionSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9-]+$/u);
const awsAccountIdSchema = z.string().regex(/^[0-9]{12}$/u);
const requestSchema = z.object({
  bucket: s3BucketSchema,
  region: awsRegionSchema,
  storageObjectKey: z.string(),
  requiredUntil: z.date(),
});
const configurationSchema = z.object({
  accountId: awsAccountIdSchema,
  bucket: s3BucketSchema,
  region: awsRegionSchema,
});

export interface S3AccessGrantsLiveKitRecordingUploadAuthorizerConfiguration {
  accountId: string;
  bucket: string;
  region: string;
}

export interface LiveKitRecordingS3ControlClient {
  send(command: GetDataAccessCommand): Promise<GetDataAccessCommandOutput>;
}

export interface S3AccessGrantsLiveKitRecordingUploadAuthorizerDependencies {
  now?: () => Date;
  s3Control?: LiveKitRecordingS3ControlClient;
}

export class S3AccessGrantsLiveKitRecordingUploadAuthorizer implements LiveKitRecordingUploadAuthorizer {
  readonly uploadAuthorizationPolicy =
    LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY;
  private readonly configuration: z.infer<typeof configurationSchema>;
  private readonly now: () => Date;
  private readonly s3Control: LiveKitRecordingS3ControlClient;

  constructor(
    configuration: S3AccessGrantsLiveKitRecordingUploadAuthorizerConfiguration,
    dependencies: S3AccessGrantsLiveKitRecordingUploadAuthorizerDependencies = {},
  ) {
    this.configuration = configurationSchema.parse(configuration);
    this.now = dependencies.now ?? (() => new Date());
    this.s3Control =
      dependencies.s3Control ??
      new S3ControlClient({ region: this.configuration.region });
  }

  async authorizeUpload(
    request: LiveKitRecordingUploadAuthorizationRequest,
  ): Promise<LiveKitRecordingUploadAuthorization> {
    try {
      const parsed = requestSchema.parse(request);
      if (
        parsed.bucket !== this.configuration.bucket ||
        parsed.region !== this.configuration.region
      )
        throw new TypeError("Recording upload scope mismatch");
      const storageObjectKey = parseLiveKitRecordingStorageObjectKey(
        parsed.storageObjectKey,
      );
      const now = this.now();
      const requiredMilliseconds =
        parsed.requiredUntil.getTime() - now.getTime();
      if (requiredMilliseconds <= 0)
        throw new RangeError(
          "Recording upload authorization is not future-dated",
        );
      const requiredSeconds = Math.ceil(requiredMilliseconds / 1_000);
      if (requiredSeconds > MAXIMUM_ACCESS_GRANTS_SESSION_SECONDS)
        throw new RangeError(
          "Recording upload authorization exceeds the S3 Access Grants limit",
        );
      const durationSeconds = Math.max(
        MINIMUM_ACCESS_GRANTS_SESSION_SECONDS,
        requiredSeconds,
      );
      const target = `s3://${this.configuration.bucket}/${storageObjectKey}`;
      const response = await this.s3Control.send(
        new GetDataAccessCommand({
          AccountId: this.configuration.accountId,
          Target: target,
          TargetType: S3PrefixType.Object,
          Permission: Permission.WRITE,
          Privilege: Privilege.Minimal,
          DurationSeconds: durationSeconds,
          AuditContext: `upskill-livekit-egress:${storageObjectKey}`,
        }),
      );
      const credentials = response.Credentials;
      const checkedAt = this.now();
      if (
        response.MatchedGrantTarget !== target ||
        !credentials?.AccessKeyId ||
        !credentials.SecretAccessKey ||
        !credentials.SessionToken ||
        !credentials.Expiration ||
        credentials.Expiration <= checkedAt ||
        credentials.Expiration < parsed.requiredUntil
      )
        throw new TypeError(
          "AWS returned incomplete or insufficient upload authorization",
        );
      return {
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken,
        expiresAt: credentials.Expiration,
      };
    } catch {
      throw new LiveKitRecordingUploadAuthorizationError();
    }
  }
}
