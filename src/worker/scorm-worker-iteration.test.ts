import { describe, expect, it, vi } from "vitest";
import { runScormWorkerIteration } from "./scorm-worker-iteration";

describe("runScormWorkerIteration", () => {
  it("uses a non-blocking queue receive after dispatching outbox work", async () => {
    const consumeNextWorkMessage = vi
      .fn()
      .mockResolvedValue({ status: "no-work" });

    await runScormWorkerIteration({
      dispatchAvailableOutboxEvents: vi.fn().mockResolvedValue({
        outcomes: [
          { status: "logged", eventId: "audit_1" },
          { status: "logged", eventId: "audit_2" },
        ],
        limitReached: false,
      }),
      consumeNextWorkMessage,
    });

    expect(consumeNextWorkMessage).toHaveBeenCalledWith(0);
  });

  it("retains long polling when the outbox is empty", async () => {
    const consumeNextWorkMessage = vi
      .fn()
      .mockResolvedValue({ status: "no-work" });

    await runScormWorkerIteration({
      dispatchAvailableOutboxEvents: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      consumeNextWorkMessage,
    });

    expect(consumeNextWorkMessage).toHaveBeenCalledWith(undefined);
  });
});
