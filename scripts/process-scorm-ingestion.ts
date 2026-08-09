import { destroyDatabase } from "#/server/db/database.server";
import { dispatchNextOutboxEvent } from "#/server/outbox/outbox-dispatcher.server";
import { destroyQueueClient } from "#/server/queue/sqs.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { consumeNextScormMessage } from "#/server/scorm/scorm-ingestion-consumer.server";

try {
  const dispatch = await dispatchNextOutboxEvent();
  const consumption = await consumeNextScormMessage();
  logServerEvent({
    level:
      dispatch.status === "retry" || consumption.status === "retry"
        ? "warn"
        : "info",
    event: "worker.once_completed",
    fields: {
      status: `${dispatch.status}:${consumption.status}`,
      ...(dispatch.status !== "no-work" ? { eventId: dispatch.eventId } : {}),
      ...(consumption.status !== "no-work"
        ? { messageId: consumption.messageId }
        : {}),
    },
  });
  if (dispatch.status === "retry" || consumption.status === "retry")
    process.exitCode = 75;
} finally {
  destroyQueueClient();
  await destroyDatabase();
}
