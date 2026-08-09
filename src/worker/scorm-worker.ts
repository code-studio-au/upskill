import { destroyDatabase } from "#/server/db/database.server";
import { dispatchNextOutboxEvent } from "#/server/outbox/outbox-dispatcher.server";
import { destroyQueueClient } from "#/server/queue/sqs.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { consumeNextScormMessage } from "#/server/scorm/scorm-ingestion-consumer.server";

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
    const dispatch = await dispatchNextOutboxEvent();
    const consumption = await consumeNextScormMessage();
    if (dispatch.status !== "no-work")
      logServerEvent({
        level: dispatch.status === "retry" ? "warn" : "info",
        event: "worker.outbox_processed",
        fields: {
          status: dispatch.status,
          eventId: dispatch.eventId,
          ...(dispatch.status === "dispatched"
            ? { messageId: dispatch.messageId }
            : {}),
        },
      });
    if (consumption.status !== "no-work")
      logServerEvent({
        level: consumption.status === "retry" ? "warn" : "info",
        event: "worker.scorm_processed",
        fields: {
          status: consumption.status,
          messageId: consumption.messageId,
          receiveCount: consumption.receiveCount,
          ...(consumption.status === "processed"
            ? {
                eventId: consumption.eventId,
                packageVersionId: consumption.packageVersionId,
                outcome: consumption.outcome.status,
              }
            : {}),
        },
      });
    if (dispatch.status === "no-work" && consumption.status === "no-work")
      await pause(1_000);
  }
} catch (error) {
  logServerEvent({ level: "error", event: "worker.fatal", error });
  process.exitCode = 1;
} finally {
  destroyQueueClient();
  await destroyDatabase();
}
