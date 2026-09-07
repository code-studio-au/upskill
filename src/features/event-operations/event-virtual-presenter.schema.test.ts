import { describe, expect, it } from "vitest";
import { eventVirtualPresenterCredentialResultSchema } from "./event-operations.schema";

describe("event virtual presenter credential response", () => {
  const ready = {
    status: "ready" as const,
    credential: {
      token: "signed-livekit-presenter-token",
      websocketUrl: "wss://tenant.livekit.cloud",
      expiresAt: "2026-09-06T10:00:00.000Z",
      generation: 2,
    },
  };

  it("accepts an exact-room presenter credential", () => {
    expect(eventVirtualPresenterCredentialResultSchema.parse(ready)).toEqual(
      ready,
    );
  });

  it.each([
    "https://tenant.livekit.cloud",
    "wss://user@tenant.livekit.cloud",
    "wss://tenant.livekit.cloud/other-room",
  ])("rejects a non-canonical WebSocket URL: %s", (websocketUrl) => {
    expect(
      eventVirtualPresenterCredentialResultSchema.safeParse({
        ...ready,
        credential: { ...ready.credential, websocketUrl },
      }).success,
    ).toBe(false);
  });

  it("rejects attendee-only and unknown denial reasons", () => {
    expect(
      eventVirtualPresenterCredentialResultSchema.safeParse({
        status: "conflict",
        reason: "waiting_for_admission",
      }).success,
    ).toBe(false);
  });
});
