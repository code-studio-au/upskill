import type { OutboxDispatchBatch } from "#/server/outbox/outbox-dispatcher.server";
import type { WorkConsumerOutcome } from "#/server/scorm/scorm-ingestion-consumer.server";

export interface ScormWorkerIterationDependencies {
  dispatchAvailableOutboxEvents: () => Promise<OutboxDispatchBatch>;
  consumeNextWorkMessage: (
    waitTimeSeconds?: number,
  ) => Promise<WorkConsumerOutcome>;
}

export interface ScormWorkerIterationOutcome {
  dispatch: OutboxDispatchBatch;
  consumption: WorkConsumerOutcome;
}

export async function runScormWorkerIteration(
  dependencies: ScormWorkerIterationDependencies,
): Promise<ScormWorkerIterationOutcome> {
  const dispatch = await dependencies.dispatchAvailableOutboxEvents();
  const consumption = await dependencies.consumeNextWorkMessage(
    dispatch.outcomes.length > 0 ? 0 : undefined,
  );
  return { dispatch, consumption };
}
