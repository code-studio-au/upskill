import "@tanstack/react-start/server-only";

import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { getServerEnv } from "#/server/env.server";

export interface ReceivedQueueMessage {
  body: string;
  messageId: string;
  receiptHandle: string;
  receiveCount: number;
}

export interface QueueCounts {
  available: number;
  delayed: number;
  inFlight: number;
}

let client: SQSClient | undefined;

function getQueueClient(): SQSClient {
  if (client) return client;
  const env = getServerEnv();
  client = new SQSClient({
    region: env.AWS_REGION,
    ...(env.SQS_ENDPOINT
      ? {
          endpoint: env.SQS_ENDPOINT,
          credentials: {
            accessKeyId: "elasticmq",
            secretAccessKey: "elasticmq",
          },
        }
      : {}),
  });
  return client;
}

export async function sendQueueMessage(
  body: string,
  queueUrl = getServerEnv().SQS_QUEUE_URL,
): Promise<string> {
  const response = await getQueueClient().send(
    new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }),
  );
  if (!response.MessageId) throw new Error("SQS did not return a message ID");
  return response.MessageId;
}

export async function receiveQueueMessage(
  queueUrl = getServerEnv().SQS_QUEUE_URL,
  waitTimeSeconds = getServerEnv().SQS_RECEIVE_WAIT_SECONDS,
): Promise<ReceivedQueueMessage | undefined> {
  const response = await getQueueClient().send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: waitTimeSeconds,
      MessageSystemAttributeNames: ["ApproximateReceiveCount"],
    }),
  );
  const message = response.Messages?.[0];
  if (!message) return undefined;
  if (!message.Body || !message.MessageId || !message.ReceiptHandle)
    throw new Error("SQS returned an incomplete message");
  const receiveCount = Number.parseInt(
    message.Attributes?.ApproximateReceiveCount ?? "1",
    10,
  );
  if (!Number.isSafeInteger(receiveCount) || receiveCount < 1)
    throw new Error("SQS returned an invalid receive count");
  return {
    body: message.Body,
    messageId: message.MessageId,
    receiptHandle: message.ReceiptHandle,
    receiveCount,
  };
}

export async function deleteQueueMessage(
  receiptHandle: string,
  queueUrl = getServerEnv().SQS_QUEUE_URL,
): Promise<void> {
  await getQueueClient().send(
    new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
    }),
  );
}

export async function changeQueueMessageVisibility(
  receiptHandle: string,
  visibilityTimeoutSeconds: number,
  queueUrl = getServerEnv().SQS_QUEUE_URL,
): Promise<void> {
  await getQueueClient().send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: visibilityTimeoutSeconds,
    }),
  );
}

export async function getQueueCounts(
  queueUrl = getServerEnv().SQS_QUEUE_URL,
): Promise<QueueCounts> {
  const response = await getQueueClient().send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: [
        "ApproximateNumberOfMessages",
        "ApproximateNumberOfMessagesDelayed",
        "ApproximateNumberOfMessagesNotVisible",
      ],
    }),
  );
  return {
    available: Number(response.Attributes?.ApproximateNumberOfMessages ?? 0),
    delayed: Number(
      response.Attributes?.ApproximateNumberOfMessagesDelayed ?? 0,
    ),
    inFlight: Number(
      response.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0,
    ),
  };
}

export async function purgeQueue(
  queueUrl = getServerEnv().SQS_QUEUE_URL,
): Promise<void> {
  await getQueueClient().send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
}

export function destroyQueueClient(): void {
  client?.destroy();
  client = undefined;
}
