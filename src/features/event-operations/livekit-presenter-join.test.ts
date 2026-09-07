import { describe, expect, it, vi } from "vitest";
import {
  prepareLiveKitPresenterJoin,
  presenterCredentialCanStartConnection,
} from "./livekit-presenter-join";

describe("LiveKit presenter join preparation", () => {
  const input = {
    eventOccurrenceId: "occurrence-1",
    eventSessionId: "session-1",
  };

  it("does not reserve a credential when the browser is unsupported", async () => {
    const requestCredential = vi.fn();
    await expect(
      prepareLiveKitPresenterJoin(input, {
        isBrowserSupported: () => Promise.resolve(false),
        requestCredential,
      }),
    ).resolves.toEqual({ status: "unsupported" });
    expect(requestCredential).not.toHaveBeenCalled();
  });

  it("checks support before requesting and validating a credential", async () => {
    const calls: Array<string> = [];
    const result = await prepareLiveKitPresenterJoin(input, {
      isBrowserSupported: () => {
        calls.push("support");
        return Promise.resolve(true);
      },
      requestCredential: () => {
        calls.push("credential");
        return Promise.resolve({
          status: "conflict",
          reason: "provider_unavailable",
        });
      },
    });
    expect(calls).toEqual(["support", "credential"]);
    expect(result).toEqual({
      status: "credential-result",
      result: { status: "conflict", reason: "provider_unavailable" },
    });
  });

  it("rejects an invalid credential response", async () => {
    await expect(
      prepareLiveKitPresenterJoin(input, {
        isBrowserSupported: () => Promise.resolve(true),
        requestCredential: () =>
          Promise.resolve({ status: "ready", credential: { token: "leak" } }),
      }),
    ).rejects.toThrow();
  });

  it("requires enough credential lifetime to finish the provider connection", () => {
    const now = Date.parse("2026-09-06T10:00:00.000Z");

    expect(
      presenterCredentialCanStartConnection("2026-09-06T10:00:05.001Z", now),
    ).toBe(true);
    expect(
      presenterCredentialCanStartConnection("2026-09-06T10:00:05.000Z", now),
    ).toBe(false);
    expect(
      presenterCredentialCanStartConnection("2026-09-06T09:59:59.000Z", now),
    ).toBe(false);
    expect(presenterCredentialCanStartConnection("invalid", now)).toBe(false);
  });
});
