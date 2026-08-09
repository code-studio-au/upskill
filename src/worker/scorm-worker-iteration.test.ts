import { describe, expect, it, vi } from "vitest";
import { runScormWorkerIteration } from "./scorm-worker-iteration";

describe("runScormWorkerIteration", () => {
  it("uses a non-blocking queue receive after dispatching outbox work", async () => {
    const consumeNextScormMessage = vi
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
      consumeNextScormMessage,
    });

    expect(consumeNextScormMessage).toHaveBeenCalledWith(0);
  });

  it("retains long polling when the outbox is empty", async () => {
    const consumeNextScormMessage = vi
      .fn()
      .mockResolvedValue({ status: "no-work" });

    await runScormWorkerIteration({
      dispatchAvailableOutboxEvents: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      consumeNextScormMessage,
    });

    expect(consumeNextScormMessage).toHaveBeenCalledWith(undefined);
  });
});
