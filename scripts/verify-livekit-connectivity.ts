import { createConfiguredLiveKitProvider } from "../src/server/livekit/livekit-provider.server.ts";

const provider = createConfiguredLiveKitProvider();
if (!provider)
  throw new Error(
    "LiveKit connectivity verification requires LIVEKIT_ENABLED=true and complete local configuration",
  );

await provider.checkHealth();
console.log("LiveKit server API connectivity verified");
