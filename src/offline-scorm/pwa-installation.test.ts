import { describe, expect, it, vi } from "vitest";
import {
  OFFLINE_SCORM_PWA_HANDOFF_STORAGE_KEY,
  isRelatedWebApplicationInstalled,
  isStandaloneApplication,
  rememberOfflineScormPwaHandoff,
} from "#/offline-scorm/pwa-installation";

describe("offline application installation detection", () => {
  it("recognizes standalone display modes and the iOS standalone flag", () => {
    expect(
      isStandaloneApplication({ matchMedia: () => ({ matches: true }) }, {}),
    ).toBe(true);
    expect(
      isStandaloneApplication(
        { matchMedia: () => ({ matches: false }) },
        { standalone: true },
      ),
    ).toBe(true);
    expect(
      isStandaloneApplication({ matchMedia: () => ({ matches: false }) }, {}),
    ).toBe(false);
  });

  it("recognizes a related installed web application", async () => {
    const getInstalledRelatedApps = vi.fn(() =>
      Promise.resolve([{ platform: "play" }, { platform: "webapp" }]),
    );

    await expect(
      isRelatedWebApplicationInstalled({ getInstalledRelatedApps }),
    ).resolves.toBe(true);
    expect(getInstalledRelatedApps).toHaveBeenCalledOnce();
  });

  it("falls back when installation detection is unavailable or rejected", async () => {
    await expect(isRelatedWebApplicationInstalled({})).resolves.toBe(false);
    await expect(
      isRelatedWebApplicationInstalled({
        getInstalledRelatedApps: vi.fn(() =>
          Promise.reject(new Error("not allowed")),
        ),
      }),
    ).resolves.toBe(false);
  });

  it("stores only a bounded offline-learning handoff path", () => {
    const storage = { setItem: vi.fn() };
    expect(
      rememberOfflineScormPwaHandoff(
        "https://app.example.test/offline-learning.html?enrollmentId=enrollment_1#module",
        storage,
      ),
    ).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      OFFLINE_SCORM_PWA_HANDOFF_STORAGE_KEY,
      "/offline-learning.html?enrollmentId=enrollment_1#module",
    );
    expect(
      rememberOfflineScormPwaHandoff(
        "https://app.example.test/dashboard",
        storage,
      ),
    ).toBe(false);
    expect(rememberOfflineScormPwaHandoff("not a URL", storage)).toBe(false);
  });
});
