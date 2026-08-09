import { destroyDatabase } from "#/server/db/database.server";
import { dispatchNextOutboxEvent } from "#/server/outbox/outbox-dispatcher.server";
import { destroyQueueClient } from "#/server/queue/sqs.server";
import { consumeNextScormMessage } from "#/server/scorm/scorm-ingestion-consumer.server";

try {
  const dispatch = await dispatchNextOutboxEvent();
  const consumption = await consumeNextScormMessage();
  console.log(JSON.stringify({ dispatch, consumption }));
  if (dispatch.status === "retry" || consumption.status === "retry")
    process.exitCode = 75;
} finally {
  destroyQueueClient();
  await destroyDatabase();
}
