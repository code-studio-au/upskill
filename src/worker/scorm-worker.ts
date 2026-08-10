import { destroyDatabase } from "#/server/db/database.server";
import { dispatchAvailableOutboxEvents } from "#/server/outbox/outbox-dispatcher.server";
import { destroyQueueClient } from "#/server/queue/sqs.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { consumeNextScormMessage } from "#/server/scorm/scorm-ingestion-consumer.server";
import { runScormWorkerIteration } from "./scorm-worker-iteration";

const shutdown = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    shutdown.abort();
  });

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

try {
  while (!shutdown.signal.aborted) {
    const { dispatch, consumption } = await runScormWorkerIteration({
      dispatchAvailableOutboxEvents,
      consumeNextScormMessage,
    });
    for (const outcome of dispatch.outcomes)
      logServerEvent({
        level: outcome.status === "retry" ? "warn" : "info",
        event: "worker.outbox_processed",
        fields: {
          status: outcome.status,
          eventId: outcome.eventId,
          ...(outcome.status === "dispatched"
            ? { messageId: outcome.messageId }
            : {}),
        },
      });
    if (consumption.status !== "no-work")
      logServerEvent({
        level: consumption.status === "retry" ? "warn" : "info",
        event: "worker.content_processed",
        fields: {
          status: consumption.status,
          messageId: consumption.messageId,
          receiveCount: consumption.receiveCount,
          ...(consumption.status === "processed"
            ? {
                eventId: consumption.eventId,
                aggregateId: consumption.aggregateId,
                outcome: consumption.outcome.status,
              }
            : {}),
        },
      });
    if (dispatch.outcomes.length === 0 && consumption.status === "no-work")
      await pause(1_000);
  }
} catch (error) {
  logServerEvent({ level: "error", event: "worker.fatal", error });
  process.exitCode = 1;
} finally {
  destroyQueueClient();
  await destroyDatabase();
}
