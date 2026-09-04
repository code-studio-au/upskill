import { describe, expect, it, vi } from "vitest";
import { runScormWorkerIteration } from "./scorm-worker-iteration";

describe("runScormWorkerIteration", () => {
  it("uses a non-blocking queue receive after dispatching outbox work", async () => {
    const consumeNextWorkMessage = vi
      .fn()
      .mockResolvedValue({ status: "no-work" });

    await runScormWorkerIteration({
      processAvailableEventCommunicationSchedules: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      processAvailableEventVirtualRoomOperations: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
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
      processAvailableEventCommunicationSchedules: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      processAvailableEventVirtualRoomOperations: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      dispatchAvailableOutboxEvents: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      consumeNextWorkMessage,
    });

    expect(consumeNextWorkMessage).toHaveBeenCalledWith(undefined);
  });

  it("uses a non-blocking queue receive after materializing scheduled communications", async () => {
    const consumeNextWorkMessage = vi
      .fn()
      .mockResolvedValue({ status: "no-work" });

    await runScormWorkerIteration({
      processAvailableEventCommunicationSchedules: vi.fn().mockResolvedValue({
        outcomes: [
          {
            status: "completed",
            scheduleId: "schedule_1",
            recipientCount: 2,
          },
        ],
        limitReached: false,
      }),
      processAvailableEventVirtualRoomOperations: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      dispatchAvailableOutboxEvents: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      consumeNextWorkMessage,
    });

    expect(consumeNextWorkMessage).toHaveBeenCalledWith(0);
  });

  it("uses a non-blocking queue receive after processing room operations", async () => {
    const consumeNextWorkMessage = vi
      .fn()
      .mockResolvedValue({ status: "no-work" });

    await runScormWorkerIteration({
      processAvailableEventCommunicationSchedules: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      processAvailableEventVirtualRoomOperations: vi.fn().mockResolvedValue({
        outcomes: [
          {
            status: "processed",
            operationId: "operation_1",
            roomId: "room_1",
            kind: "ensure_room",
          },
        ],
        limitReached: false,
      }),
      dispatchAvailableOutboxEvents: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      consumeNextWorkMessage,
    });

    expect(consumeNextWorkMessage).toHaveBeenCalledWith(0);
  });
});
