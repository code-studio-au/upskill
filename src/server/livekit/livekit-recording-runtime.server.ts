import "@tanstack/react-start/server-only";

import { getServerEnv, type ServerEnv } from "#/server/env.server";
import {
  getEnabledLiveKitConfiguration,
  type EnabledLiveKitConfiguration,
} from "./livekit-provider.server";
import {
  LiveKitCloudRecordingProvider,
  type LiveKitCloudRecordingConfiguration,
  type LiveKitRecordingUploadAuthorizer,
} from "./livekit-recording-provider.cloud.server";
import type { LiveKitRecordingProvider } from "./livekit-recording-provider.server";
import { S3AccessGrantsLiveKitRecordingUploadAuthorizer } from "./livekit-recording-upload-authorizer.access-grants.aws.server";
import { AwsLiveKitRecordingUploadAuthorizer } from "./livekit-recording-upload-authorizer.aws.server";
import { usesRoleChainedRecordingUploadAuthorization } from "./livekit-recording-duration-policy.server";

function recordingConfiguration(
  environment: ServerEnv,
  liveKit: EnabledLiveKitConfiguration,
): LiveKitCloudRecordingConfiguration {
  return {
    url: liveKit.url,
    apiKey: liveKit.apiKey,
    apiSecret: liveKit.apiSecret,
    region: environment.AWS_REGION,
    bucket: environment.S3_RECORDING_BUCKET,
  };
}

function uploadAuthorizer(
  environment: ServerEnv,
): LiveKitRecordingUploadAuthorizer | null {
  if (usesRoleChainedRecordingUploadAuthorization(environment.APP_ENV)) {
    if (!environment.LIVEKIT_RECORDING_UPLOAD_ROLE_ARN) return null;
    return new AwsLiveKitRecordingUploadAuthorizer({
      bucket: environment.S3_RECORDING_BUCKET,
      region: environment.AWS_REGION,
      roleArn: environment.LIVEKIT_RECORDING_UPLOAD_ROLE_ARN,
    });
  }
  if (!environment.LIVEKIT_RECORDING_ACCESS_GRANTS_ACCOUNT_ID) return null;
  return new S3AccessGrantsLiveKitRecordingUploadAuthorizer({
    accountId: environment.LIVEKIT_RECORDING_ACCESS_GRANTS_ACCOUNT_ID,
    bucket: environment.S3_RECORDING_BUCKET,
    region: environment.AWS_REGION,
  });
}

export function createConfiguredLiveKitRecordingProvider(
  environment: ServerEnv = getServerEnv(),
): LiveKitRecordingProvider | null {
  const liveKit = getEnabledLiveKitConfiguration(environment);
  if (!liveKit) return null;
  const authorizer = uploadAuthorizer(environment);
  if (!authorizer) return null;
  return new LiveKitCloudRecordingProvider(
    recordingConfiguration(environment, liveKit),
    authorizer,
  );
}
