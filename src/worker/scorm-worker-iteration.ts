import type { OutboxDispatchBatch } from "#/server/outbox/outbox-dispatcher.server";
import type { ScormConsumerOutcome } from "#/server/scorm/scorm-ingestion-consumer.server";

export interface ScormWorkerIterationDependencies {
  dispatchAvailableOutboxEvents: () => Promise<OutboxDispatchBatch>;
  consumeNextScormMessage: (
    waitTimeSeconds?: number,
  ) => Promise<ScormConsumerOutcome>;
}

export interface ScormWorkerIterationOutcome {
  dispatch: OutboxDispatchBatch;
  consumption: ScormConsumerOutcome;
}

export async function runScormWorkerIteration(
  dependencies: ScormWorkerIterationDependencies,
): Promise<ScormWorkerIterationOutcome> {
  const dispatch = await dependencies.dispatchAvailableOutboxEvents();
  const consumption = await dependencies.consumeNextScormMessage(
    dispatch.outcomes.length > 0 ? 0 : undefined,
  );
  return { dispatch, consumption };
}
