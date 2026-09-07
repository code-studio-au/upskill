import { describe, expect, it } from "vitest";
import {
  attendeeCredentialDisposition,
  attendeeCredentialCanStartConnection,
  attendeeTerminalConnectionPhase,
  shouldReloadLobbyAfterDisconnect,
} from "./livekit-attendee-lifecycle";

describe("LiveKit attendee connection lifecycle", () => {
  it("returns policy outcomes to the server-owned lobby before retrying", () => {
    expect(
      attendeeCredentialDisposition({
        status: "conflict",
        reason: "locked",
      }),
    ).toBe("reload-lobby");
    expect(
      attendeeCredentialDisposition({
        status: "conflict",
        reason: "ended",
      }),
    ).toBe("reload-lobby");
    expect(
      attendeeCredentialDisposition({
        status: "conflict",
        reason: "revoked",
      }),
    ).toBe("reload-lobby");
    expect(attendeeCredentialDisposition({ status: "unauthenticated" })).toBe(
      "reload-lobby",
    );
    expect(attendeeCredentialDisposition({ status: "not-found" })).toBe(
      "reload-lobby",
    );
  });

  it("keeps only capacity and provider failures as in-room retries", () => {
    expect(
      attendeeCredentialDisposition({
        status: "conflict",
        reason: "capacity_reached",
      }),
    ).toBe("retry");
    expect(
      attendeeCredentialDisposition({
        status: "conflict",
        reason: "provider_unavailable",
      }),
    ).toBe("retry");
  });

  it("connects only after the server returns a ready credential", () => {
    expect(
      attendeeCredentialDisposition({
        status: "ready",
        credential: {
          token: "token",
          websocketUrl: "wss://tenant.livekit.cloud",
          expiresAt: "2026-09-06T10:05:00.000Z",
          generation: 1,
        },
      }),
    ).toBe("connect");
  });

  it("requires enough credential lifetime to finish a connection attempt", () => {
    const now = Date.parse("2026-09-06T10:00:00.000Z");

    expect(
      attendeeCredentialCanStartConnection("2026-09-06T10:00:05.001Z", now),
    ).toBe(true);
    expect(
      attendeeCredentialCanStartConnection("2026-09-06T10:00:05.000Z", now),
    ).toBe(false);
    expect(
      attendeeCredentialCanStartConnection("2026-09-06T09:59:59.000Z", now),
    ).toBe(false);
    expect(attendeeCredentialCanStartConnection("invalid", now)).toBe(false);
  });

  it.each([
    ["duplicate_identity", "duplicate"],
    ["participant_removed", "removed"],
    ["room_ended", "ended"],
    ["connection_lost", "disconnected"],
    ["client_initiated", "disconnected"],
    [null, "disconnected"],
  ] as const)("maps %s to %s", (reason, phase) => {
    expect(attendeeTerminalConnectionPhase(reason)).toBe(phase);
  });

  it("returns to the server lobby only for policy-owned terminal outcomes", () => {
    expect(shouldReloadLobbyAfterDisconnect("removed")).toBe(true);
    expect(shouldReloadLobbyAfterDisconnect("ended")).toBe(true);
    expect(shouldReloadLobbyAfterDisconnect("duplicate")).toBe(false);
    expect(shouldReloadLobbyAfterDisconnect("disconnected")).toBe(false);
  });
});
