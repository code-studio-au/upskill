import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTIFICATION_DELIVERY_TOPIC,
  RESOURCE_DELETION_TOPIC,
} from "#/server/queue/work-message";

const mocks = vi.hoisted(() => ({
  changeVisibility: vi.fn(),
  deleteMessage: vi.fn(),
  deleteObject: vi.fn(),
  deleteObjectPrefix: vi.fn(),
  ingest: vi.fn(),
  deliverNotification: vi.fn(),
  receive: vi.fn(),
}));
vi.mock("#/server/env.server", () => ({
  getServerEnv: () => ({
    S3_PRIVATE_RESOURCES_BUCKET: "private-resources",
    S3_QUARANTINE_BUCKET: "quarantine",
    S3_LEARNING_CONTENT_BUCKET: "content",
    SQS_VISIBILITY_TIMEOUT_SECONDS: 30,
  }),
}));
vi.mock("#/server/storage/object-storage.server", () => ({
  deleteObject: mocks.deleteObject,
  deleteObjectPrefix: mocks.deleteObjectPrefix,
}));
vi.mock("#/server/scorm/scorm-package-ingestion.server", () => ({
  ingestScormPackageVersion: mocks.ingest,
}));
vi.mock("#/server/notifications/notification-delivery.server", () => ({
  deliverNotification: mocks.deliverNotification,
}));
vi.mock("#/server/queue/sqs.server", () => ({
  changeQueueMessageVisibility: mocks.changeVisibility,
  deleteQueueMessage: mocks.deleteMessage,
  receiveQueueMessage: mocks.receive,
}));

describe("content work consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes only the validated private resource object", async () => {
    const resourceVersionId = "resource_version_1";
    const objectKey = `resources/${resourceVersionId}/${"a".repeat(64)}.pdf`;
    const { handleWorkMessage } =
      await import("./scorm-ingestion-consumer.server");
    await expect(
      handleWorkMessage({
        version: 1,
        eventId: "outbox_1",
        topic: RESOURCE_DELETION_TOPIC,
        aggregateId: resourceVersionId,
        payload: { resourceVersionId, objectKey },
      }),
    ).resolves.toEqual({ status: "storage-removed" });
    expect(mocks.deleteObject).toHaveBeenCalledWith(
      "private-resources",
      objectKey,
    );
  });

  it("rejects a resource aggregate mismatch before storage access", async () => {
    const { handleWorkMessage } =
      await import("./scorm-ingestion-consumer.server");
    await expect(
      handleWorkMessage({
        version: 1,
        eventId: "outbox_1",
        topic: RESOURCE_DELETION_TOPIC,
        aggregateId: "resource_version_other",
        payload: {
          resourceVersionId: "resource_version_1",
          objectKey: `resources/resource_version_1/${"a".repeat(64)}.pdf`,
        },
      }),
    ).rejects.toThrow("aggregate and resource version do not match");
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("clears both exact SCORM storage prefixes", async () => {
    const { handleWorkMessage } =
      await import("./scorm-ingestion-consumer.server");
    const packageVersionId = "scorm_pkgv_1";
    await expect(
      handleWorkMessage({
        version: 1,
        eventId: "outbox_2",
        topic: "scorm.package_delete_requested",
        aggregateId: packageVersionId,
        payload: {
          packageVersionId,
          quarantinePrefix: `scorm/${packageVersionId}/`,
          contentPrefix: `scorm/${packageVersionId}/${"b".repeat(64)}/`,
        },
      }),
    ).resolves.toEqual({ status: "storage-removed" });
    expect(mocks.deleteObjectPrefix).toHaveBeenCalledTimes(2);
  });

  it("delegates SCORM ingestion and rejects an aggregate mismatch", async () => {
    mocks.ingest.mockResolvedValue({ status: "ready" });
    const { handleWorkMessage } =
      await import("./scorm-ingestion-consumer.server");
    await expect(
      handleWorkMessage({
        version: 1,
        eventId: "outbox_3",
        topic: "scorm.package_ingest_requested",
        aggregateId: "scorm_pkgv_1",
        payload: {
          packageVersionId: "scorm_pkgv_1",
          quarantineKey: "scorm/scorm_pkgv_1/archive.zip",
        },
      }),
    ).resolves.toEqual({ status: "ready" });
    await expect(
      handleWorkMessage({
        version: 1,
        eventId: "outbox_4",
        topic: "scorm.package_ingest_requested",
        aggregateId: "scorm_pkgv_other",
        payload: {
          packageVersionId: "scorm_pkgv_1",
          quarantineKey: "scorm/scorm_pkgv_1/archive.zip",
        },
      }),
    ).rejects.toThrow("aggregate and package version do not match");
  });

  it("delegates notification work to the notification boundary", async () => {
    mocks.deliverNotification.mockResolvedValue({ status: "delivered" });
    const { handleWorkMessage } =
      await import("./scorm-ingestion-consumer.server");
    await expect(
      handleWorkMessage({
        version: 1,
        eventId: "outbox_notification_1",
        topic: NOTIFICATION_DELIVERY_TOPIC,
        aggregateId: "notification_1",
        payload: { notificationId: "notification_1" },
      }),
    ).resolves.toEqual({ status: "delivered" });
    expect(mocks.deliverNotification).toHaveBeenCalledWith("notification_1");
  });

  it("returns no work without attempting queue acknowledgement", async () => {
    mocks.receive.mockResolvedValue(undefined);
    const { consumeNextWorkMessage } =
      await import("./scorm-ingestion-consumer.server");
    await expect(consumeNextWorkMessage(0)).resolves.toEqual({
      status: "no-work",
    });
    expect(mocks.deleteMessage).not.toHaveBeenCalled();
  });

  it("acknowledges valid work and retains malformed work for retry", async () => {
    const resourceVersionId = "resource_version_2";
    mocks.receive.mockResolvedValueOnce({
      body: JSON.stringify({
        version: 1,
        eventId: "outbox_5",
        topic: RESOURCE_DELETION_TOPIC,
        aggregateId: resourceVersionId,
        payload: {
          resourceVersionId,
          objectKey: `resources/${resourceVersionId}/${"c".repeat(64)}.pdf`,
        },
      }),
      messageId: "message_1",
      receiptHandle: "receipt_1",
      receiveCount: 1,
    });
    const { consumeNextWorkMessage } =
      await import("./scorm-ingestion-consumer.server");
    await expect(consumeNextWorkMessage()).resolves.toMatchObject({
      status: "processed",
      eventId: "outbox_5",
      aggregateId: resourceVersionId,
    });
    expect(mocks.deleteMessage).toHaveBeenCalledWith("receipt_1");

    mocks.receive.mockResolvedValueOnce({
      body: "not-json",
      messageId: "message_2",
      receiptHandle: "receipt_2",
      receiveCount: 2,
    });
    await expect(consumeNextWorkMessage()).resolves.toMatchObject({
      status: "retry",
      messageId: "message_2",
      receiveCount: 2,
    });
    expect(mocks.deleteMessage).not.toHaveBeenCalledWith("receipt_2");
  });
});
