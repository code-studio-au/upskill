import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import {
  AssumeRoleCommand,
  STSClient,
  type AssumeRoleCommandOutput,
} from "@aws-sdk/client-sts";
import { z } from "#/validation/zod.server";
import {
  type LiveKitRecordingUploadAuthorization,
  type LiveKitRecordingUploadAuthorizationRequest,
  type LiveKitRecordingUploadAuthorizer,
} from "./livekit-recording-provider.cloud.server";
import { LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY } from "./livekit-recording-duration-policy.server";
import { parseLiveKitRecordingStorageObjectKey } from "./livekit-recording-provider.server";

const MINIMUM_STS_SESSION_SECONDS = 15 * 60;
const MAXIMUM_CHAINED_STS_SESSION_SECONDS =
  LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY.maximumLifetimeMilliseconds /
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
const roleArnSchema = z
  .string()
  .min(20)
  .max(2_048)
  .regex(/^arn:([a-z0-9-]+):iam::[0-9]{12}:role\/[A-Za-z0-9+=,.@_/-]+$/u);
const roleSessionNameSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[\w+=,.@-]+$/u);
const requestSchema = z.object({
  bucket: s3BucketSchema,
  region: awsRegionSchema,
  storageObjectKey: z.string(),
  requiredUntil: z.date(),
});
const configurationSchema = z.object({
  bucket: s3BucketSchema,
  region: awsRegionSchema,
  roleArn: roleArnSchema,
});

export interface AwsLiveKitRecordingUploadAuthorizerConfiguration {
  bucket: string;
  region: string;
  roleArn: string;
}

export interface LiveKitRecordingStsClient {
  send(command: AssumeRoleCommand): Promise<AssumeRoleCommandOutput>;
}

export interface AwsLiveKitRecordingUploadAuthorizerDependencies {
  now?: () => Date;
  sessionId?: () => string;
  sts?: LiveKitRecordingStsClient;
}

export class LiveKitRecordingUploadAuthorizationError extends Error {
  readonly code = "LIVEKIT_RECORDING_UPLOAD_AUTHORIZATION_FAILED";

  constructor() {
    super("LiveKit recording upload authorization failed");
    this.name = "LiveKitRecordingUploadAuthorizationError";
  }
}

function uploadSessionPolicy(
  partition: string,
  bucket: string,
  storageObjectKey: string,
): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "WriteExactRecordingObject",
        Effect: "Allow",
        Action: "s3:PutObject",
        Resource: `arn:${partition}:s3:::${bucket}/${storageObjectKey}`,
      },
    ],
  });
}

export class AwsLiveKitRecordingUploadAuthorizer implements LiveKitRecordingUploadAuthorizer {
  readonly uploadAuthorizationPolicy =
    LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY;
  private readonly configuration: z.infer<typeof configurationSchema>;
  private readonly now: () => Date;
  private readonly sessionId: () => string;
  private readonly sts: LiveKitRecordingStsClient;

  constructor(
    configuration: AwsLiveKitRecordingUploadAuthorizerConfiguration,
    dependencies: AwsLiveKitRecordingUploadAuthorizerDependencies = {},
  ) {
    this.configuration = configurationSchema.parse(configuration);
    this.now = dependencies.now ?? (() => new Date());
    this.sessionId = dependencies.sessionId ?? randomUUID;
    this.sts =
      dependencies.sts ?? new STSClient({ region: this.configuration.region });
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
      if (requiredSeconds > MAXIMUM_CHAINED_STS_SESSION_SECONDS)
        throw new RangeError(
          "Recording upload authorization exceeds the role-chain limit",
        );
      const durationSeconds = Math.max(
        MINIMUM_STS_SESSION_SECONDS,
        requiredSeconds,
      );
      const partition = this.configuration.roleArn.split(":")[1];
      if (!partition)
        throw new TypeError("Recording upload role ARN is invalid");
      const roleSessionName = roleSessionNameSchema.parse(
        `upskill-egress-${this.sessionId()}`,
      );
      const response = await this.sts.send(
        new AssumeRoleCommand({
          RoleArn: this.configuration.roleArn,
          RoleSessionName: roleSessionName,
          DurationSeconds: durationSeconds,
          Policy: uploadSessionPolicy(
            partition,
            this.configuration.bucket,
            storageObjectKey,
          ),
        }),
      );
      const credentials = response.Credentials;
      const checkedAt = this.now();
      if (
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
