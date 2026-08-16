import "@tanstack/react-start/server-only";

import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";
import {
  changeQueueMessageVisibility,
  deleteQueueMessage,
  receiveQueueMessage,
} from "#/server/queue/sqs.server";
import {
  NOTIFICATION_DELIVERY_TOPIC,
  parseWorkerMessage,
  RESOURCE_DELETION_TOPIC,
  SCORM_DELETION_TOPIC,
  type WorkerMessage,
} from "#/server/queue/work-message";
import {
  deliverNotification,
  type NotificationDeliveryOutcome,
} from "#/server/notifications/notification-delivery.server";
import {
  ingestScormPackageVersion,
  type ScormIngestionOutcome,
} from "#/server/scorm/scorm-package-ingestion.server";
import {
  deleteObject,
  deleteObjectPrefix,
} from "#/server/storage/object-storage.server";

type ScormWorkOutcome =
  | ScormIngestionOutcome
  | NotificationDeliveryOutcome
  | { status: "storage-removed" };

export type WorkConsumerOutcome =
  | { status: "no-work" }
  | {
      status: "processed";
      eventId: string;
      messageId: string;
      aggregateId: string;
      receiveCount: number;
      outcome: ScormWorkOutcome;
    }
  | {
      status: "retry";
      messageId: string;
      receiveCount: number;
      error: string;
    };

export async function handleWorkMessage(
  message: WorkerMessage,
): Promise<ScormWorkOutcome> {
  if (message.topic === NOTIFICATION_DELIVERY_TOPIC)
    return deliverNotification(message.payload.notificationId);
  if (message.topic === RESOURCE_DELETION_TOPIC) {
    if (message.aggregateId !== message.payload.resourceVersionId)
      throw new Error(
        "Work message aggregate and resource version do not match",
      );
    await deleteObject(
      getServerEnv().S3_PRIVATE_RESOURCES_BUCKET,
      message.payload.objectKey,
    );
    return { status: "storage-removed" };
  }
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

export async function consumeNextWorkMessage(
  waitTimeSeconds?: number,
): Promise<WorkConsumerOutcome> {
  const received = await receiveQueueMessage(undefined, waitTimeSeconds);
  if (!received) return { status: "no-work" };
  const env = getServerEnv();
  let heartbeat: NodeJS.Timeout | undefined;
  try {
    const message = parseWorkerMessage(received.body);
    const heartbeatSeconds = Math.max(
      10,
      Math.floor(env.SQS_VISIBILITY_TIMEOUT_SECONDS / 3),
    );
    heartbeat = setInterval(() => {
      void changeQueueMessageVisibility(
        received.receiptHandle,
        env.SQS_VISIBILITY_TIMEOUT_SECONDS,
      ).catch((error: unknown) => {
        logServerEvent({
          level: "error",
          event: "worker.visibility_heartbeat_failed",
          error,
          fields: { messageId: received.messageId },
        });
      });
    }, heartbeatSeconds * 1_000);
    heartbeat.unref();
    const outcome = await handleWorkMessage(message);
    await deleteQueueMessage(received.receiptHandle);
    return {
      status: "processed",
      eventId: message.eventId,
      messageId: received.messageId,
      aggregateId: message.aggregateId,
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
