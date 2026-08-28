import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  responses: [] as Array<unknown>,
  send: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("#/server/env.server", () => ({
  getServerEnv: () => ({
    AWS_REGION: "ap-southeast-2",
    SQS_ENDPOINT: "http://127.0.0.1:9324",
    SQS_QUEUE_URL: "http://127.0.0.1:9324/queue/upskill",
    SQS_RECEIVE_WAIT_SECONDS: 0,
  }),
}));

vi.mock("@aws-sdk/client-sqs", () => {
  class Command {
    constructor(public input: unknown) {}
  }
  return {
    ChangeMessageVisibilityCommand: Command,
    DeleteMessageCommand: Command,
    GetQueueAttributesCommand: Command,
    PurgeQueueCommand: Command,
    ReceiveMessageCommand: Command,
    SendMessageCommand: Command,
    SQSClient: class {
      destroy = mocks.destroy;
      send = mocks.send;
    },
  };
});

import {
  changeQueueMessageVisibility,
  deleteQueueMessage,
  destroyQueueClient,
  getQueueCounts,
  purgeQueue,
  receiveQueueMessage,
  sendQueueMessage,
} from "./sqs.server";

describe("SQS queue boundary", () => {
  beforeEach(() => {
    mocks.responses = [];
    destroyQueueClient();
    mocks.send
      .mockReset()
      .mockImplementation(() => Promise.resolve(mocks.responses.shift()));
    mocks.destroy.mockReset();
  });

  it("maps send, receive and count responses", async () => {
    mocks.responses.push(
      { MessageId: "message-one" },
      {
        Messages: [
          {
            Body: "payload",
            MessageId: "message-two",
            ReceiptHandle: "receipt-two",
            Attributes: { ApproximateReceiveCount: "3" },
          },
        ],
      },
      {
        Attributes: {
          ApproximateNumberOfMessages: "4",
          ApproximateNumberOfMessagesDelayed: "2",
          ApproximateNumberOfMessagesNotVisible: "1",
        },
      },
    );
    await expect(sendQueueMessage("payload")).resolves.toBe("message-one");
    await expect(receiveQueueMessage()).resolves.toEqual({
      body: "payload",
      messageId: "message-two",
      receiptHandle: "receipt-two",
      receiveCount: 3,
    });
    await expect(getQueueCounts()).resolves.toEqual({
      available: 4,
      delayed: 2,
      inFlight: 1,
    });
  });

  it("issues acknowledgement, visibility and purge operations", async () => {
    mocks.responses.push({}, {}, {});
    await deleteQueueMessage("receipt");
    await changeQueueMessageVisibility("receipt", 60);
    await purgeQueue();
    expect(mocks.send).toHaveBeenCalledTimes(3);
    destroyQueueClient();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("rejects incomplete broker responses", async () => {
    mocks.responses.push({}, { Messages: [{ MessageId: "incomplete" }] });
    await expect(sendQueueMessage("payload")).rejects.toThrow("message ID");
    await expect(receiveQueueMessage()).rejects.toThrow("incomplete message");
  });
});
