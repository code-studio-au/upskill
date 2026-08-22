import type { OutboxDispatchBatch } from "#/server/outbox/outbox-dispatcher.server";
import type { EventCommunicationScheduleBatch } from "#/server/notifications/event-communication-execution.server";
import type { WorkConsumerOutcome } from "#/server/scorm/scorm-ingestion-consumer.server";

export interface ScormWorkerIterationDependencies {
  processAvailableEventCommunicationSchedules: () => Promise<EventCommunicationScheduleBatch>;
  dispatchAvailableOutboxEvents: () => Promise<OutboxDispatchBatch>;
  consumeNextWorkMessage: (
    waitTimeSeconds?: number,
  ) => Promise<WorkConsumerOutcome>;
}

export interface ScormWorkerIterationOutcome {
  schedules: EventCommunicationScheduleBatch;
  dispatch: OutboxDispatchBatch;
  consumption: WorkConsumerOutcome;
}

export async function runScormWorkerIteration(
  dependencies: ScormWorkerIterationDependencies,
): Promise<ScormWorkerIterationOutcome> {
  const schedules =
    await dependencies.processAvailableEventCommunicationSchedules();
  const dispatch = await dependencies.dispatchAvailableOutboxEvents();
  const consumption = await dependencies.consumeNextWorkMessage(
    schedules.outcomes.length > 0 || dispatch.outcomes.length > 0
      ? 0
      : undefined,
  );
  return { schedules, dispatch, consumption };
}
