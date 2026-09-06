import { describe, expect, it, vi } from "vitest";
import { prepareLiveKitAttendeeJoin } from "./livekit-attendee-join";

describe("LiveKit attendee join preflight", () => {
  it("does not reserve a credential when the browser is unsupported", async () => {
    const requestCredential = vi.fn();

    await expect(
      prepareLiveKitAttendeeJoin(
        "public-reference",
        new AbortController().signal,
        {
          isBrowserSupported: () => Promise.resolve(false),
          requestCredential,
        },
      ),
    ).resolves.toEqual({ status: "unsupported" });
    expect(requestCredential).not.toHaveBeenCalled();
  });

  it("checks support before requesting a credential", async () => {
    const calls: Array<string> = [];
    const result = await prepareLiveKitAttendeeJoin(
      "public-reference",
      new AbortController().signal,
      {
        isBrowserSupported: () => {
          calls.push("support");
          return Promise.resolve(true);
        },
        requestCredential: (publicReference) => {
          calls.push(`credential:${publicReference}`);
          return Promise.resolve({
            status: "conflict",
            reason: "provider_unavailable",
          });
        },
      },
    );

    expect(calls).toEqual(["support", "credential:public-reference"]);
    expect(result).toEqual({
      status: "credential-result",
      result: { status: "conflict", reason: "provider_unavailable" },
    });
  });
});
