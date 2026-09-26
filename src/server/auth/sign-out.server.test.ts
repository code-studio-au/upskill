import { describe, expect, it, vi } from "vitest";
import { offlineScormSignOutGate } from "#/server/auth/sign-out.server";

describe("offline SCORM sign-out gate", () => {
  it("blocks an authenticated sign-out while server cleanup is retained", async () => {
    const prepareSignOut = vi.fn(() => Promise.resolve("blocked" as const));
    const response = await offlineScormSignOutGate(
      new Request("https://app.example.test/api/auth/sign-out", {
        method: "POST",
      }),
      {
        getSession: () =>
          Promise.resolve({
            sessionId: "session_1",
            userId: "learner_1",
          }),
        prepareSignOut,
      },
    );

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      error: "offline_cleanup_required",
    });
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(prepareSignOut).toHaveBeenCalledWith({
      sessionId: "session_1",
      userId: "learner_1",
    });
  });

  it("allows unrelated, unauthenticated, stale, and prepared requests", async () => {
    const prepareSignOut = vi.fn(() => Promise.resolve("ready" as const));
    const dependencies = {
      getSession: () =>
        Promise.resolve({ sessionId: "session_1", userId: "learner_1" }),
      prepareSignOut,
    };
    await expect(
      offlineScormSignOutGate(
        new Request("https://app.example.test/api/auth/sign-in", {
          method: "POST",
        }),
        dependencies,
      ),
    ).resolves.toBeUndefined();
    await expect(
      offlineScormSignOutGate(
        new Request("https://app.example.test/api/auth/sign-out/", {
          method: "POST",
        }),
        dependencies,
      ),
    ).resolves.toBeUndefined();
    expect(prepareSignOut).toHaveBeenCalledWith({
      sessionId: "session_1",
      userId: "learner_1",
    });
    await expect(
      offlineScormSignOutGate(
        new Request("https://app.example.test/api/auth/sign-out", {
          method: "POST",
        }),
        dependencies,
      ),
    ).resolves.toBeUndefined();
    await expect(
      offlineScormSignOutGate(
        new Request("https://app.example.test/api/auth/sign-out", {
          method: "POST",
        }),
        {
          getSession: () => Promise.resolve(undefined),
          prepareSignOut: vi.fn(),
        },
      ),
    ).resolves.toBeUndefined();
    await expect(
      offlineScormSignOutGate(
        new Request("https://app.example.test/api/auth/sign-out", {
          method: "POST",
        }),
        {
          getSession: dependencies.getSession,
          prepareSignOut: () => Promise.resolve("stale"),
        },
      ),
    ).resolves.toBeUndefined();
  });
});
