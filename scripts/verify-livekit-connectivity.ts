import { createConfiguredLiveKitProvider } from "../src/server/livekit/livekit-provider.server.ts";
import { createConfiguredLiveKitRecordingProvider } from "../src/server/livekit/livekit-recording-runtime.server.ts";

const requireRecording = process.argv.slice(2).includes("--recording");

const provider = createConfiguredLiveKitProvider();
if (!provider)
  throw new Error(
    "LiveKit connectivity verification requires LIVEKIT_ENABLED=true and complete local configuration",
  );

if (requireRecording && !createConfiguredLiveKitRecordingProvider())
  throw new Error(
    "LiveKit recording readiness verification requires the environment-specific upload authorization configuration",
  );

await provider.checkHealth();
console.log(
  requireRecording
    ? "LiveKit server API connectivity and recording runtime configuration verified"
    : "LiveKit server API connectivity verified",
);
