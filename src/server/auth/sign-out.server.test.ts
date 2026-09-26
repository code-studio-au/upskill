import { describe, expect, it, vi } from "vitest";
import { offlineScormSignOutGate } from "#/server/auth/sign-out.server";

describe("offline SCORM sign-out gate", () => {
  it("blocks an authenticated sign-out while server cleanup is retained", async () => {
    const hasRetainedOfflineState = vi.fn(() => Promise.resolve(true));
    const response = await offlineScormSignOutGate(
      new Request("https://app.example.test/api/auth/sign-out", {
        method: "POST",
      }),
      {
        getUserId: () => Promise.resolve("learner_1"),
        hasRetainedOfflineState,
      },
    );

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      error: "offline_cleanup_required",
    });
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(hasRetainedOfflineState).toHaveBeenCalledWith("learner_1");
  });

  it("allows unrelated, unauthenticated, and fully cleared requests", async () => {
    const hasRetainedOfflineState = vi.fn(() => Promise.resolve(false));
    const dependencies = {
      getUserId: () => Promise.resolve("learner_1"),
      hasRetainedOfflineState,
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
          getUserId: () => Promise.resolve(undefined),
          hasRetainedOfflineState: vi.fn(),
        },
      ),
    ).resolves.toBeUndefined();
  });
});
