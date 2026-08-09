import "@tanstack/react-start/server-only";

import { getServerEnv } from "#/server/env.server";
import {
  changeQueueMessageVisibility,
  deleteQueueMessage,
  receiveQueueMessage,
} from "#/server/queue/sqs.server";
import {
  parseScormWorkMessage,
  SCORM_DELETION_TOPIC,
  type ScormWorkMessage,
} from "#/server/queue/work-message";
import {
  ingestScormPackageVersion,
  type ScormIngestionOutcome,
} from "#/server/scorm/scorm-package-ingestion.server";
import { deleteObjectPrefix } from "#/server/storage/object-storage.server";

type ScormWorkOutcome = ScormIngestionOutcome | { status: "storage-removed" };

export type ScormConsumerOutcome =
  | { status: "no-work" }
  | {
      status: "processed";
      eventId: string;
      messageId: string;
      packageVersionId: string;
      receiveCount: number;
      outcome: ScormWorkOutcome;
    }
  | {
      status: "retry";
      messageId: string;
      receiveCount: number;
      error: string;
    };

async function handleScormWorkMessage(
  message: ScormWorkMessage,
): Promise<ScormWorkOutcome> {
  if (message.aggregateId !== message.payload.packageVersionId)
    throw new Error("Work message aggregate and package version do not match");
  if (message.topic === SCORM_DELETION_TOPIC) {
    const env = getServerEnv();
    await deleteObjectPrefix(
      env.S3_QUARANTINE_BUCKET,
      message.payload.quarantinePrefix,
    );
    await deleteObjectPrefix(
      env.S3_LEARNING_CONTENT_BUCKET,
      message.payload.contentPrefix,
    );
    return { status: "storage-removed" };
  }
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
    const message = parseScormWorkMessage(received.body);
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
    const outcome = await handleScormWorkMessage(message);
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
