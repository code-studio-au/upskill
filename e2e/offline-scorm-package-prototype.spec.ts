import { expect, test, type Page } from "@playwright/test";

const prototypePath = "/__offline-scorm-package-prototype/application.html";

interface PrototypeEvent {
  type: string;
  cookie?: string;
  cacheReady?: boolean;
  spoolEntryId?: string;
}

interface PrototypeControl {
  events(): PrototypeEvent[];
  command(
    target: "learning" | "package",
    action: string,
    detail?: unknown,
  ): void;
  reloadPackage(): void;
  addCompetitor(): void;
  origins: {
    application: string;
    learning: string;
    package: string;
  };
}

declare global {
  interface Window {
    offlineScormPrototype?: PrototypeControl;
  }
}

async function prototypeEvents(page: Page): Promise<PrototypeEvent[]> {
  return await page.evaluate(
    () => window.offlineScormPrototype?.events() ?? [],
  );
}

async function waitForPrototypeEvent(
  page: Page,
  type: string,
  minimumCount = 1,
): Promise<void> {
  await expect
    .poll(async () => {
      const events = await prototypeEvents(page);
      return events.filter((event) => event.type === type).length;
    })
    .toBeGreaterThanOrEqual(minimumCount);
}

test("isolated offline SCORM package survives reload, drains and cleans up", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-mobile" &&
      testInfo.project.name !== "firefox",
    "The prototype qualification matrix starts with Chromium and Firefox",
  );
  test.skip(
    process.env.PLAYWRIGHT_HTTPS === "true",
    "The loopback package-site prototype is qualified in the core lane",
  );

  await page.goto(prototypePath);
  await waitForPrototypeEvent(page, "prototype-learning-ready");
  await waitForPrototypeEvent(page, "prototype-package-ready");
  await waitForPrototypeEvent(page, "prototype-channel-bound");
  await waitForPrototypeEvent(page, "prototype-player-ready");
  await expect(
    page.frameLocator("#package-frame").locator("#vendor-ready"),
  ).toHaveText("Rise fixture ready");

  const firstReady = (await prototypeEvents(page)).find(
    (event) => event.type === "prototype-package-ready",
  );
  expect(firstReady).toMatchObject({ cacheReady: true, cookie: "" });
  await expect(page.locator("body > main > iframe")).toHaveCount(2);

  const origins = await page.evaluate(() =>
    structuredClone(window.offlineScormPrototype?.origins),
  );
  expect(new URL(origins?.application ?? "").hostname).toBe("127.0.0.1");
  expect(new URL(origins?.learning ?? "").hostname).toBe("127.0.0.1");
  expect(new URL(origins?.package ?? "").hostname).toBe("127.0.0.2");

  await page.evaluate(() => window.offlineScormPrototype?.addCompetitor());
  await expect(
    page.frameLocator("#package-competitor").locator("#package-status"),
  ).toHaveText("prototype-lock-busy");
  await expect(
    page.frameLocator("#package-competitor").locator("#vendor-ready"),
  ).toHaveCount(0);
  await page.locator("#package-competitor").evaluate((element) => {
    element.remove();
  });

  await page.evaluate(() => {
    window.offlineScormPrototype?.command("learning", "acknowledge", false);
    window.offlineScormPrototype?.command("package", "commit");
  });
  await waitForPrototypeEvent(page, "prototype-spool-staged");
  await waitForPrototypeEvent(page, "prototype-learning-received");
  await expect
    .poll(async () => {
      const count: number = await page
        .frameLocator("#package-frame")
        .locator("#package-status")
        .evaluate(() => {
          const stored = localStorage.getItem("upskill-offline-scorm-spool-v1");
          if (!stored) return 0;
          const parsed: unknown = JSON.parse(stored);
          if (
            !parsed ||
            typeof parsed !== "object" ||
            !("entries" in parsed) ||
            !Array.isArray(parsed.entries)
          )
            throw new Error("Invalid prototype spool");
          return parsed.entries.length;
        });
      return count;
    })
    .toBe(1);

  await page.evaluate(() =>
    window.offlineScormPrototype?.command("package", "cleanup"),
  );
  await waitForPrototypeEvent(page, "prototype-cleanup-blocked");
  expect(
    (await prototypeEvents(page)).some(
      (event) => event.type === "prototype-cleanup-complete",
    ),
  ).toBe(false);
  await expect
    .poll(
      async () =>
        await page
          .frameLocator("#package-frame")
          .locator("#package-status")
          .evaluate(() => {
            const stored = localStorage.getItem(
              "upskill-offline-scorm-spool-v1",
            );
            if (!stored) return 0;
            const parsed: unknown = JSON.parse(stored);
            if (
              !parsed ||
              typeof parsed !== "object" ||
              !("entries" in parsed) ||
              !Array.isArray(parsed.entries)
            )
              throw new Error("Invalid prototype spool");
            return parsed.entries.length;
          }),
    )
    .toBe(1);
  await page.evaluate(() => window.offlineScormPrototype?.addCompetitor());
  await expect(
    page.frameLocator("#package-competitor").locator("#package-status"),
  ).toHaveText("prototype-lock-busy");
  await page.locator("#package-competitor").evaluate((element) => {
    element.remove();
  });

  await context.setOffline(true);
  try {
    await page.evaluate(() => window.offlineScormPrototype?.reloadPackage());
    await waitForPrototypeEvent(page, "prototype-package-ready", 2);
    await waitForPrototypeEvent(page, "prototype-channel-bound", 2);
    await expect(
      page.frameLocator("#package-frame").locator("#vendor-ready"),
    ).toHaveCount(0);
    await page.evaluate(() =>
      window.offlineScormPrototype?.command("learning", "acknowledge", true),
    );
    await waitForPrototypeEvent(page, "prototype-spool-drained");
    await waitForPrototypeEvent(page, "prototype-player-ready", 2);
    await expect(
      page.frameLocator("#package-frame").locator("#vendor-ready"),
    ).toHaveText("Rise fixture ready");
  } finally {
    await context.setOffline(false);
  }

  await expect
    .poll(async () => {
      const count: number = await page
        .frameLocator("#package-frame")
        .locator("#package-status")
        .evaluate(() => {
          const stored = localStorage.getItem("upskill-offline-scorm-spool-v1");
          if (!stored) return 0;
          const parsed: unknown = JSON.parse(stored);
          if (
            !parsed ||
            typeof parsed !== "object" ||
            !("entries" in parsed) ||
            !Array.isArray(parsed.entries)
          )
            throw new Error("Invalid prototype spool");
          return parsed.entries.length;
        });
      return count;
    })
    .toBe(0);

  const corruptCacheResult: string = await page
    .frameLocator("#package-frame")
    .locator("#package-status")
    .evaluate(async () => {
      const cacheName = (await caches.keys()).find(
        (name) =>
          name.startsWith("upskill-offline-scorm-package-v1-prototype-") &&
          !name.includes("-staging-"),
      );
      if (!cacheName) throw new Error("Ready package cache is missing");
      const vendorUrl = new URL(
        "/__offline-scorm-package-prototype/vendor.html",
        location.origin,
      );
      const cache = await caches.open(cacheName);
      if (!(await cache.delete(vendorUrl.href)))
        throw new Error("Cached vendor fixture is missing");
      try {
        await fetch(vendorUrl.href);
        return "network-fallback";
      } catch {
        return "failed-closed";
      }
    });
  expect(corruptCacheResult).toBe("failed-closed");

  await page.evaluate(() =>
    window.offlineScormPrototype?.command("package", "cleanup"),
  );
  await waitForPrototypeEvent(page, "prototype-cleanup-complete");
  await expect
    .poll(
      async () =>
        await page
          .frameLocator("#package-frame")
          .locator("#package-status")
          .evaluate(async () => ({
            caches: (await caches.keys()).length,
            registrations: (await navigator.serviceWorker.getRegistrations())
              .length,
            spool: localStorage.getItem("upskill-offline-scorm-spool-v1"),
          })),
    )
    .toEqual({ caches: 0, registrations: 0, spool: null });
});

test("Safari qualification requires an explicit package-site storage decision", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "webkit",
    "This qualification target exercises the Safari-compatible WebKit flow",
  );
  test.skip(
    process.env.PLAYWRIGHT_HTTPS === "true",
    "The loopback package-site prototype is qualified in the core lane",
  );

  await page.goto(prototypePath);
  await page
    .frameLocator("#package-frame")
    .getByRole("button", { name: "Enable offline course" })
    .click();
  await expect
    .poll(async () =>
      (await prototypeEvents(page))
        .map((event) => event.type)
        .find((type) =>
          [
            "prototype-storage-access-granted",
            "prototype-storage-access-denied",
            "prototype-storage-access-not-required",
          ].includes(type),
        ),
    )
    .toBeTruthy();
  const events = await prototypeEvents(page);
  const storageDenied = events.some(
    (event) => event.type === "prototype-storage-access-denied",
  );
  expect(storageDenied).toBe(false);
  await waitForPrototypeEvent(page, "prototype-package-ready");
  expect(
    events.some((event) => event.type === "prototype-completed-and-synced"),
  ).toBe(false);
});
