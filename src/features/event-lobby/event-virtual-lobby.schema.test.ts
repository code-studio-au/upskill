import { describe, expect, it } from "vitest";
import { eventVirtualAttendeeCredentialResultSchema } from "./event-virtual-lobby.schema";

describe("event virtual attendee credential response", () => {
  const credential = {
    status: "ready" as const,
    credential: {
      token: "signed-livekit-token",
      websocketUrl: "wss://tenant.livekit.cloud",
      expiresAt: "2026-09-06T10:00:00.000Z",
      generation: 2,
    },
  };

  it("accepts a bounded in-memory LiveKit credential", () => {
    expect(
      eventVirtualAttendeeCredentialResultSchema.parse(credential),
    ).toEqual(credential);
  });

  it.each([
    "not-a-url",
    "https://tenant.livekit.cloud",
    "wss://user@tenant.livekit.cloud",
    "wss://tenant.livekit.cloud/path",
    "wss://tenant.livekit.cloud?room=other",
  ])("rejects a non-canonical WebSocket URL: %s", (websocketUrl) => {
    expect(
      eventVirtualAttendeeCredentialResultSchema.safeParse({
        ...credential,
        credential: { ...credential.credential, websocketUrl },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown credential denial reasons", () => {
    expect(
      eventVirtualAttendeeCredentialResultSchema.safeParse({
        status: "conflict",
        reason: "presenter_only",
      }).success,
    ).toBe(false);
  });
});
