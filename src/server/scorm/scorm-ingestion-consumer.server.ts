import "@tanstack/react-start/server-only";

import { getServerEnv } from "#/server/env.server";
import {
  changeQueueMessageVisibility,
  deleteQueueMessage,
  receiveQueueMessage,
} from "#/server/queue/sqs.server";
import {
  parseScormIngestionWorkMessage,
  type ScormIngestionWorkMessage,
} from "#/server/queue/work-message";
import {
  ingestScormPackageVersion,
  type ScormIngestionOutcome,
} from "#/server/scorm/scorm-package-ingestion.server";

export type ScormConsumerOutcome =
  | { status: "no-work" }
  | {
      status: "processed";
      eventId: string;
      messageId: string;
      packageVersionId: string;
      receiveCount: number;
      outcome: ScormIngestionOutcome;
    }
  | {
      status: "retry";
      messageId: string;
      receiveCount: number;
      error: string;
    };

async function handleScormIngestionWorkMessage(
  message: ScormIngestionWorkMessage,
): Promise<ScormIngestionOutcome> {
  if (message.aggregateId !== message.payload.packageVersionId)
    throw new Error("Work message aggregate and package version do not match");
  return ingestScormPackageVersion(
    message.payload.packageVersionId,
    message.payload.quarantineKey,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown worker error";
}

export async function consumeNextScormMessage(): Promise<ScormConsumerOutcome> {
  const received = await receiveQueueMessage();
  if (!received) return { status: "no-work" };
  const env = getServerEnv();
  let heartbeat: NodeJS.Timeout | undefined;
  try {
    const message = parseScormIngestionWorkMessage(received.body);
    const heartbeatSeconds = Math.max(
      10,
      Math.floor(env.SQS_VISIBILITY_TIMEOUT_SECONDS / 3),
    );
    heartbeat = setInterval(() => {
      void changeQueueMessageVisibility(
        received.receiptHandle,
        env.SQS_VISIBILITY_TIMEOUT_SECONDS,
      ).catch((error: unknown) => {
        console.error(
          JSON.stringify({
            event: "worker.visibility_heartbeat_failed",
            messageId: received.messageId,
            error: errorMessage(error),
          }),
        );
      });
    }, heartbeatSeconds * 1_000);
    heartbeat.unref();
    const outcome = await handleScormIngestionWorkMessage(message);
    await deleteQueueMessage(received.receiptHandle);
    return {
      status: "processed",
      eventId: message.eventId,
      messageId: received.messageId,
      packageVersionId: message.payload.packageVersionId,
      receiveCount: received.receiveCount,
      outcome,
    };
  } catch (error) {
    return {
      status: "retry",
      messageId: received.messageId,
      receiveCount: received.receiveCount,
      error: errorMessage(error),
    };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}
