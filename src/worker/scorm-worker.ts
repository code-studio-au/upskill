import { destroyDatabase } from "#/server/db/database.server";
import { dispatchNextOutboxEvent } from "#/server/outbox/outbox-dispatcher.server";
import { destroyQueueClient } from "#/server/queue/sqs.server";
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
      console.log(JSON.stringify({ event: "worker.outbox", ...dispatch }));
    if (consumption.status !== "no-work")
      console.log(JSON.stringify({ event: "worker.scorm", ...consumption }));
    if (dispatch.status === "no-work" && consumption.status === "no-work")
      await pause(1_000);
  }
} catch (error) {
  console.error(
    JSON.stringify({
      event: "worker.fatal",
      error: error instanceof Error ? error.message : "Unknown worker error",
    }),
  );
  process.exitCode = 1;
} finally {
  destroyQueueClient();
  await destroyDatabase();
}
