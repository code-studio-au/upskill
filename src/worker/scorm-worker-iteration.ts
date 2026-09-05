import type { OutboxDispatchBatch } from "#/server/outbox/outbox-dispatcher.server";
import type { EventCommunicationScheduleBatch } from "#/server/notifications/event-communication-execution.server";
import type { WorkConsumerOutcome } from "#/server/scorm/scorm-ingestion-consumer.server";
import type { VirtualRoomOperationBatch } from "#/server/events/event-virtual-room.server";
import type { EventVirtualRecoveryDeliveryBatch } from "#/server/events/event-virtual-recovery-delivery.server";

export interface ScormWorkerIterationDependencies {
  processAvailableEventCommunicationSchedules: () => Promise<EventCommunicationScheduleBatch>;
  processAvailableEventVirtualRoomOperations: () => Promise<VirtualRoomOperationBatch>;
  processAvailableEventVirtualRecoveryDeliveries: () => Promise<EventVirtualRecoveryDeliveryBatch>;
  dispatchAvailableOutboxEvents: () => Promise<OutboxDispatchBatch>;
  consumeNextWorkMessage: (
    waitTimeSeconds?: number,
  ) => Promise<WorkConsumerOutcome>;
}

export interface ScormWorkerIterationOutcome {
  schedules: EventCommunicationScheduleBatch;
  virtualRooms: VirtualRoomOperationBatch;
  virtualRecoveryDeliveries: EventVirtualRecoveryDeliveryBatch;
  dispatch: OutboxDispatchBatch;
  consumption: WorkConsumerOutcome;
}

export async function runScormWorkerIteration(
  dependencies: ScormWorkerIterationDependencies,
): Promise<ScormWorkerIterationOutcome> {
  const [schedules, virtualRooms, virtualRecoveryDeliveries] =
    await Promise.all([
      dependencies.processAvailableEventCommunicationSchedules(),
      dependencies.processAvailableEventVirtualRoomOperations(),
      dependencies.processAvailableEventVirtualRecoveryDeliveries(),
    ]);
  const dispatch = await dependencies.dispatchAvailableOutboxEvents();
  const consumption = await dependencies.consumeNextWorkMessage(
    schedules.outcomes.length > 0 ||
      virtualRooms.outcomes.length > 0 ||
      virtualRecoveryDeliveries.outcomes.length > 0 ||
      dispatch.outcomes.length > 0
      ? 0
      : undefined,
  );
  return {
    schedules,
    virtualRooms,
    virtualRecoveryDeliveries,
    dispatch,
    consumption,
  };
}
