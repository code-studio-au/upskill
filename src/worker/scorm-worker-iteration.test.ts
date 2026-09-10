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
      processAvailableLiveKitRecordingReceipts: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      processAvailableEventVirtualLobbyEligibilityRevocations: vi
        .fn()
        .mockResolvedValue({ outcomes: [], limitReached: false }),
      processAvailableEventVirtualRecoveryDeliveries: vi
        .fn()
        .mockResolvedValue({ outcomes: [], limitReached: false }),
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

  it("caps idle queue polling so eligibility reconciliation resumes promptly", async () => {
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
      processAvailableLiveKitRecordingReceipts: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      processAvailableEventVirtualLobbyEligibilityRevocations: vi
        .fn()
        .mockResolvedValue({ outcomes: [], limitReached: false }),
      processAvailableEventVirtualRecoveryDeliveries: vi
        .fn()
        .mockResolvedValue({ outcomes: [], limitReached: false }),
      dispatchAvailableOutboxEvents: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      consumeNextWorkMessage,
    });

    expect(consumeNextWorkMessage).toHaveBeenCalledWith(1);
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
      processAvailableLiveKitRecordingReceipts: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      processAvailableEventVirtualLobbyEligibilityRevocations: vi
        .fn()
        .mockResolvedValue({ outcomes: [], limitReached: false }),
      processAvailableEventVirtualRecoveryDeliveries: vi
        .fn()
        .mockResolvedValue({ outcomes: [], limitReached: false }),
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
      processAvailableLiveKitRecordingReceipts: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      processAvailableEventVirtualLobbyEligibilityRevocations: vi
        .fn()
        .mockResolvedValue({ outcomes: [], limitReached: false }),
      processAvailableEventVirtualRecoveryDeliveries: vi
        .fn()
        .mockResolvedValue({ outcomes: [], limitReached: false }),
      dispatchAvailableOutboxEvents: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      consumeNextWorkMessage,
    });

    expect(consumeNextWorkMessage).toHaveBeenCalledWith(0);
  });

  it("uses a non-blocking queue receive after revoking withdrawn lobby eligibility", async () => {
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
      processAvailableLiveKitRecordingReceipts: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      processAvailableEventVirtualLobbyEligibilityRevocations: vi
        .fn()
        .mockResolvedValue({
          outcomes: [{ status: "revoked", lobbyEntryId: "lobby_entry_1" }],
          limitReached: false,
        }),
      processAvailableEventVirtualRecoveryDeliveries: vi
        .fn()
        .mockResolvedValue({ outcomes: [], limitReached: false }),
      dispatchAvailableOutboxEvents: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      consumeNextWorkMessage,
    });

    expect(consumeNextWorkMessage).toHaveBeenCalledWith(0);
  });

  it("uses a non-blocking queue receive after processing recovery delivery", async () => {
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
      processAvailableLiveKitRecordingReceipts: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      processAvailableEventVirtualLobbyEligibilityRevocations: vi
        .fn()
        .mockResolvedValue({ outcomes: [], limitReached: false }),
      processAvailableEventVirtualRecoveryDeliveries: vi
        .fn()
        .mockResolvedValue({
          outcomes: [{ status: "sent", challengeId: "recovery_challenge_1" }],
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

  it("applies recording receipts before provider reconciliation and keeps queue polling non-blocking", async () => {
    const order: string[] = [];
    const consumeNextWorkMessage = vi
      .fn()
      .mockResolvedValue({ status: "no-work" });

    await runScormWorkerIteration({
      processAvailableEventCommunicationSchedules: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      processAvailableLiveKitRecordingReceipts: vi.fn(() => {
        order.push("receipt");
        return Promise.resolve({
          outcomes: [
            {
              status: "processed" as const,
              receiptId: "receipt_1",
              recordingId: "recording_1",
            },
          ],
          limitReached: false,
        });
      }),
      processAvailableEventVirtualRoomOperations: vi.fn(() => {
        order.push("provider");
        return Promise.resolve({ outcomes: [], limitReached: false });
      }),
      processAvailableEventVirtualLobbyEligibilityRevocations: vi
        .fn()
        .mockResolvedValue({ outcomes: [], limitReached: false }),
      processAvailableEventVirtualRecoveryDeliveries: vi
        .fn()
        .mockResolvedValue({ outcomes: [], limitReached: false }),
      dispatchAvailableOutboxEvents: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      consumeNextWorkMessage,
    });

    expect(order).toEqual(["receipt", "provider"]);
    expect(consumeNextWorkMessage).toHaveBeenCalledWith(0);
  });

  it("defers provider reconciliation while the recording receipt batch is full", async () => {
    const processAvailableEventVirtualRoomOperations = vi
      .fn()
      .mockResolvedValue({ outcomes: [], limitReached: false });
    const consumeNextWorkMessage = vi
      .fn()
      .mockResolvedValue({ status: "no-work" });

    const outcome = await runScormWorkerIteration({
      processAvailableEventCommunicationSchedules: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      processAvailableLiveKitRecordingReceipts: vi.fn().mockResolvedValue({
        outcomes: [
          {
            status: "processed" as const,
            receiptId: "receipt_1",
            recordingId: "recording_1",
          },
        ],
        limitReached: true,
      }),
      processAvailableEventVirtualRoomOperations,
      processAvailableEventVirtualLobbyEligibilityRevocations: vi
        .fn()
        .mockResolvedValue({ outcomes: [], limitReached: false }),
      processAvailableEventVirtualRecoveryDeliveries: vi
        .fn()
        .mockResolvedValue({ outcomes: [], limitReached: false }),
      dispatchAvailableOutboxEvents: vi.fn().mockResolvedValue({
        outcomes: [],
        limitReached: false,
      }),
      consumeNextWorkMessage,
    });

    expect(processAvailableEventVirtualRoomOperations).not.toHaveBeenCalled();
    expect(outcome.virtualRooms).toEqual({
      outcomes: [],
      limitReached: false,
    });
    expect(consumeNextWorkMessage).toHaveBeenCalledWith(0);
  });
});
