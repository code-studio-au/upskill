import { describe, expect, it, vi } from "vitest";
import { createOfflineScormMessageQueue } from "#/offline-scorm/offline-scorm-message-queue";

describe("offline SCORM message queue", () => {
  it("serializes spool messages and stops after the first failure", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];
    const onError = vi.fn();
    const queue = createOfflineScormMessageQueue<string>({
      async handle(message) {
        order.push(`start:${message}`);
        if (message === "first") await firstBlocked;
        if (message === "failed") throw new Error("import failed");
        order.push(`finish:${message}`);
      },
      onError,
    });

    queue("first");
    queue("second");
    await Promise.resolve();
    expect(order).toEqual(["start:first"]);
    releaseFirst?.();
    await vi.waitFor(() => {
      expect(order).toEqual([
        "start:first",
        "finish:first",
        "start:second",
        "finish:second",
      ]);
    });

    queue("failed");
    queue("after-failure");
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
    expect(order).not.toContain("start:after-failure");
  });
});
