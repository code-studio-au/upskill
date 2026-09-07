import { describe, expect, it, vi } from "vitest";
import {
  prepareLiveKitPresenterJoin,
  presenterCredentialCanStartConnection,
} from "./livekit-presenter-join";
import type { PresenterMediaSession } from "./livekit-presenter-media";

function readyMediaSession(dispose = vi.fn(() => Promise.resolve())) {
  return {
    status: "ready" as const,
    session: { dispose } as unknown as PresenterMediaSession,
  };
}

describe("LiveKit presenter join preparation", () => {
  const input = {
    eventOccurrenceId: "occurrence-1",
    eventSessionId: "session-1",
  };

  it("does not reserve a credential when the browser is unsupported", async () => {
    const requestCredential = vi.fn();
    await expect(
      prepareLiveKitPresenterJoin(
        input,
        {},
        {
          createMediaSession: () => Promise.resolve({ status: "unsupported" }),
          requestCredential,
        },
      ),
    ).resolves.toEqual({ status: "unsupported" });
    expect(requestCredential).not.toHaveBeenCalled();
  });

  it("checks support before requesting and validating a credential", async () => {
    const calls: Array<string> = [];
    const media = readyMediaSession();
    const result = await prepareLiveKitPresenterJoin(
      input,
      {},
      {
        createMediaSession: () => {
          calls.push("support");
          return Promise.resolve(media);
        },
        requestCredential: () => {
          calls.push("credential");
          return Promise.resolve({
            status: "conflict",
            reason: "provider_unavailable",
          });
        },
      },
    );
    expect(calls).toEqual(["support", "credential"]);
    expect(result).toEqual({
      status: "credential-result",
      result: { status: "conflict", reason: "provider_unavailable" },
      session: media.session,
    });
  });

  it("disposes the unused media session after an invalid credential response", async () => {
    const dispose = vi.fn(() => Promise.resolve());
    await expect(
      prepareLiveKitPresenterJoin(
        input,
        {},
        {
          createMediaSession: () => Promise.resolve(readyMediaSession(dispose)),
          requestCredential: () =>
            Promise.resolve({ status: "ready", credential: { token: "leak" } }),
        },
      ),
    ).rejects.toThrow();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("does not reserve a credential when the join is cancelled during media preparation", async () => {
    const dispose = vi.fn(() => Promise.resolve());
    const requestCredential = vi.fn();
    let current = true;
    let resolveMedia!: (media: ReturnType<typeof readyMediaSession>) => void;
    const mediaPromise = new Promise<ReturnType<typeof readyMediaSession>>(
      (resolve) => {
        resolveMedia = resolve;
      },
    );
    const preparation = prepareLiveKitPresenterJoin(
      input,
      { isCurrent: () => current },
      {
        createMediaSession: () => mediaPromise,
        requestCredential,
      },
    );

    current = false;
    resolveMedia(readyMediaSession(dispose));

    await expect(preparation).resolves.toEqual({ status: "cancelled" });
    expect(requestCredential).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
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
