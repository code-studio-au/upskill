import { describe, expect, it } from "vitest";
import type { ServerEnv } from "#/server/env.server";
import { LiveKitCloudRecordingProvider } from "./livekit-recording-provider.cloud.server";
import { createConfiguredLiveKitRecordingProvider } from "./livekit-recording-runtime.server";

function environment(
  appEnvironment: ServerEnv["APP_ENV"],
  recording: Partial<ServerEnv> = {},
): ServerEnv {
  return {
    APP_ENV: appEnvironment,
    LIVEKIT_ENABLED: true,
    LIVEKIT_URL: "wss://project.livekit.cloud",
    LIVEKIT_API_KEY: "livekit-key",
    LIVEKIT_API_SECRET: "livekit-secret-with-at-least-32-characters",
    LIVEKIT_APPROVED_MAX_PARTICIPANTS: 100,
    LIVEKIT_APPROVED_MAX_CONCURRENT_ROOMS: 5,
    AWS_REGION: "ap-southeast-2",
    S3_RECORDING_BUCKET: "upskill-recordings",
    ...recording,
  } as ServerEnv;
}

describe("configured LiveKit recording runtime", () => {
  it("keeps recording unavailable when LiveKit or the environment authorizer is absent", () => {
    expect(
      createConfiguredLiveKitRecordingProvider({
        ...environment("development"),
        LIVEKIT_ENABLED: false,
      }),
    ).toBeNull();
    expect(
      createConfiguredLiveKitRecordingProvider(environment("development")),
    ).toBeNull();
    expect(
      createConfiguredLiveKitRecordingProvider(environment("production")),
    ).toBeNull();
  });

  it("selects role chaining locally and S3 Access Grants outside local environments", () => {
    expect(
      createConfiguredLiveKitRecordingProvider(
        environment("development", {
          LIVEKIT_RECORDING_UPLOAD_ROLE_ARN:
            "arn:aws:iam::123456789012:role/upskill-development-recording-upload",
        }),
      ),
    ).toBeInstanceOf(LiveKitCloudRecordingProvider);
    expect(
      createConfiguredLiveKitRecordingProvider(
        environment("production", {
          LIVEKIT_RECORDING_UPLOAD_ROLE_ARN:
            "arn:aws:iam::123456789012:role/ignored-production-role",
          LIVEKIT_RECORDING_ACCESS_GRANTS_ACCOUNT_ID: "123456789012",
        }),
      ),
    ).toBeInstanceOf(LiveKitCloudRecordingProvider);
  });
});
