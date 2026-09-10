import type { OutboxDispatchBatch } from "#/server/outbox/outbox-dispatcher.server";
import type { EventCommunicationScheduleBatch } from "#/server/notifications/event-communication-execution.server";
import type { WorkConsumerOutcome } from "#/server/scorm/scorm-ingestion-consumer.server";
import type { VirtualRoomOperationBatch } from "#/server/events/event-virtual-room.server";
import type { EventVirtualRecoveryDeliveryBatch } from "#/server/events/event-virtual-recovery-delivery.server";
import type { EventVirtualLobbyEligibilityRevocationBatch } from "#/server/events/event-virtual-lobby-reconciliation.server";
import type { LiveKitRecordingReceiptBatch } from "#/server/events/event-virtual-recording-receipts.server";

const ELIGIBILITY_RECONCILIATION_MAX_QUEUE_WAIT_SECONDS = 1;

export interface ScormWorkerIterationDependencies {
  processAvailableEventCommunicationSchedules: () => Promise<EventCommunicationScheduleBatch>;
  processAvailableEventVirtualRoomOperations: () => Promise<VirtualRoomOperationBatch>;
  processAvailableLiveKitRecordingReceipts: () => Promise<LiveKitRecordingReceiptBatch>;
  processAvailableEventVirtualLobbyEligibilityRevocations: () => Promise<EventVirtualLobbyEligibilityRevocationBatch>;
  processAvailableEventVirtualRecoveryDeliveries: () => Promise<EventVirtualRecoveryDeliveryBatch>;
  dispatchAvailableOutboxEvents: () => Promise<OutboxDispatchBatch>;
  consumeNextWorkMessage: (
    waitTimeSeconds?: number,
  ) => Promise<WorkConsumerOutcome>;
}

export interface ScormWorkerIterationOutcome {
  schedules: EventCommunicationScheduleBatch;
  virtualRooms: VirtualRoomOperationBatch;
  liveKitRecordingReceipts: LiveKitRecordingReceiptBatch;
  virtualLobbyEligibilityRevocations: EventVirtualLobbyEligibilityRevocationBatch;
  virtualRecoveryDeliveries: EventVirtualRecoveryDeliveryBatch;
  dispatch: OutboxDispatchBatch;
  consumption: WorkConsumerOutcome;
}

export async function runScormWorkerIteration(
  dependencies: ScormWorkerIterationDependencies,
): Promise<ScormWorkerIterationOutcome> {
  const [
    schedules,
    liveKitRecordingReceipts,
    virtualLobbyEligibilityRevocations,
    virtualRecoveryDeliveries,
  ] = await Promise.all([
    dependencies.processAvailableEventCommunicationSchedules(),
    dependencies.processAvailableLiveKitRecordingReceipts(),
    dependencies.processAvailableEventVirtualLobbyEligibilityRevocations(),
    dependencies.processAvailableEventVirtualRecoveryDeliveries(),
  ]);
  const virtualRooms = liveKitRecordingReceipts.limitReached
    ? { outcomes: [], limitReached: false }
    : await dependencies.processAvailableEventVirtualRoomOperations();
  const dispatch = await dependencies.dispatchAvailableOutboxEvents();
  const consumption = await dependencies.consumeNextWorkMessage(
    schedules.outcomes.length > 0 ||
      virtualRooms.outcomes.length > 0 ||
      liveKitRecordingReceipts.outcomes.length > 0 ||
      virtualLobbyEligibilityRevocations.outcomes.length > 0 ||
      virtualRecoveryDeliveries.outcomes.length > 0 ||
      dispatch.outcomes.length > 0
      ? 0
      : ELIGIBILITY_RECONCILIATION_MAX_QUEUE_WAIT_SECONDS,
  );
  return {
    schedules,
    virtualRooms,
    liveKitRecordingReceipts,
    virtualLobbyEligibilityRevocations,
    virtualRecoveryDeliveries,
    dispatch,
    consumption,
  };
}
