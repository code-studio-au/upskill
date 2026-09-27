import { describe, expect, it, vi } from "vitest";
import {
  isRelatedWebApplicationInstalled,
  isStandaloneApplication,
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
});
