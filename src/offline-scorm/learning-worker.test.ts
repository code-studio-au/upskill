import { beforeEach, describe, expect, it, vi } from "vitest";

describe("offline SCORM learning worker cache", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("publishes v5 atomically and activates across retained clients", async () => {
    const listeners = new Map<string, EventListener>();
    const addAll = vi.fn(() => Promise.resolve());
    const deleteCache = vi.fn(() => Promise.resolve(true));
    const claim = vi.fn(() => Promise.resolve());
    const skipWaiting = vi.fn(() => Promise.resolve());
    const open = vi.fn(() => Promise.resolve({ addAll }));
    vi.stubGlobal("caches", {
      delete: deleteCache,
      keys: vi.fn(() =>
        Promise.resolve([
          "upskill-offline-scorm-learning-runtime-v1",
          "upskill-offline-scorm-learning-runtime-v2",
          "upskill-offline-scorm-learning-runtime-v3",
          "upskill-offline-scorm-learning-runtime-v4",
          "upskill-offline-scorm-learning-runtime-v5",
          "unrelated-cache",
        ]),
      ),
      open,
    });
    vi.stubGlobal("self", {
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, listener);
      },
      clients: { claim },
      location: new URL("https://learn.example.test"),
      skipWaiting,
    });

    await import("./learning-worker");

    const runExtendableEvent = async (type: "activate" | "install") => {
      let task: Promise<unknown> | undefined;
      listeners.get(type)?.({
        waitUntil(nextTask: Promise<unknown>) {
          task = nextTask;
        },
      } as unknown as Event);
      await task;
    };
    await runExtendableEvent("install");
    await runExtendableEvent("activate");

    expect(open).toHaveBeenCalledWith(
      "upskill-offline-scorm-learning-runtime-v5",
    );
    expect(addAll).toHaveBeenCalledWith([
      "/api/scorm/offline-runtime/frame.html",
      "/api/scorm/offline-runtime/learning-runtime.js",
      "/api/scorm/offline-runtime/shared.js",
    ]);
    expect(skipWaiting).toHaveBeenCalledOnce();
    expect(skipWaiting.mock.invocationCallOrder[0]).toBeGreaterThan(
      addAll.mock.invocationCallOrder[0] ?? 0,
    );
    expect(deleteCache).toHaveBeenCalledTimes(4);
    expect(deleteCache).toHaveBeenNthCalledWith(
      1,
      "upskill-offline-scorm-learning-runtime-v1",
    );
    expect(deleteCache).toHaveBeenNthCalledWith(
      2,
      "upskill-offline-scorm-learning-runtime-v2",
    );
    expect(deleteCache).toHaveBeenNthCalledWith(
      3,
      "upskill-offline-scorm-learning-runtime-v3",
    );
    expect(deleteCache).toHaveBeenNthCalledWith(
      4,
      "upskill-offline-scorm-learning-runtime-v4",
    );
    expect(claim).toHaveBeenCalledOnce();
  });
});
