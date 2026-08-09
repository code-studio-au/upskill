import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { sql } from "kysely";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { dispatchNextOutboxEvent } from "#/server/outbox/outbox-dispatcher.server";
import {
  changeQueueMessageVisibility,
  deleteQueueMessage,
  destroyQueueClient,
  getQueueCounts,
  purgeQueue,
  receiveQueueMessage,
  sendQueueMessage,
} from "#/server/queue/sqs.server";
import {
  SCORM_INGESTION_TOPIC,
  type ScormIngestionWorkMessage,
} from "#/server/queue/work-message";
import { consumeNextScormMessage } from "#/server/scorm/scorm-ingestion-consumer.server";
import {
  ingestScormPackageVersion,
  stageScormPackageArchive,
  type StagedScormPackage,
} from "#/server/scorm/scorm-package-ingestion.server";
import {
  deleteObject,
  deleteObjectPrefix,
  getObjectBytes,
} from "#/server/storage/object-storage.server";

const fixturePaths = process.argv.slice(2).filter((value) => value !== "--");
if (fixturePaths.length === 0)
  throw new Error(
    "Pass one or more local SCORM 1.2 ZIP paths after --; fixtures are not committed",
  );

const database = getDatabase();
const env = getServerEnv();
const staged: StagedScormPackage[] = [];
let ownsLocalQueues = false;

function queueTotal(
  counts: Awaited<ReturnType<typeof getQueueCounts>>,
): number {
  return counts.available + counts.delayed + counts.inFlight;
}

async function receiveEventually(
  queueUrl: string,
  attempts = 20,
): Promise<Awaited<ReturnType<typeof receiveQueueMessage>>> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const received = await receiveQueueMessage(queueUrl, 1);
    if (received) return received;
  }
  return undefined;
}

async function verifyDeadLetterRedrive(): Promise<void> {
  const marker = `dlq-verification-${randomUUID()}`;
  await sendQueueMessage(marker);
  for (
    let expectedReceiveCount = 1;
    expectedReceiveCount <= 5;
    expectedReceiveCount += 1
  ) {
    const received = await receiveEventually(env.SQS_QUEUE_URL, 5);
    assert.ok(
      received,
      `Poison message receive ${String(expectedReceiveCount)} missing`,
    );
    assert.equal(received.body, marker);
    assert.equal(received.receiveCount, expectedReceiveCount);
    await changeQueueMessageVisibility(received.receiptHandle, 0);
  }
  await receiveQueueMessage(env.SQS_QUEUE_URL, 0);
  const deadLetter = await receiveEventually(env.SQS_DEAD_LETTER_QUEUE_URL, 10);
  assert.ok(deadLetter, "Poison message did not reach the dead-letter queue");
  assert.equal(deadLetter.body, marker);
  await deleteQueueMessage(
    deadLetter.receiptHandle,
    env.SQS_DEAD_LETTER_QUEUE_URL,
  );
}

async function cleanup(): Promise<void> {
  if (ownsLocalQueues) {
    await purgeQueue(env.SQS_QUEUE_URL);
    await purgeQueue(env.SQS_DEAD_LETTER_QUEUE_URL);
  }
  for (const item of staged) {
    const version = await database
      .selectFrom("scorm_package_version")
      .select("contentPrefix")
      .where("id", "=", item.packageVersionId)
      .executeTakeFirst();
    if (version)
      await deleteObjectPrefix(
        env.S3_LEARNING_CONTENT_BUCKET,
        `${version.contentPrefix}/`,
      );
    await deleteObject(env.S3_QUARANTINE_BUCKET, item.quarantineKey);
  }
  const versionIds = staged.map(({ packageVersionId }) => packageVersionId);
  const packageIds = staged.map(({ packageId }) => packageId);
  if (versionIds.length > 0) {
    await database
      .deleteFrom("outbox_event")
      .where("aggregateId", "in", versionIds)
      .execute();
    await database
      .deleteFrom("audit_event")
      .where("subjectId", "in", versionIds)
      .execute();
    await database
      .deleteFrom("scorm_package_version")
      .where("id", "in", versionIds)
      .execute();
    await database
      .deleteFrom("scorm_package")
      .where("id", "in", packageIds)
      .execute();
  }
}

try {
  if (!env.SQS_ENDPOINT)
    throw new Error("Local SCORM verification requires SQS_ENDPOINT");
  const existingPending = await database
    .selectFrom("outbox_event")
    .select(sql<number>`count(*)::integer`.as("count"))
    .where("topic", "=", SCORM_INGESTION_TOPIC)
    .where("processedAt", "is", null)
    .executeTakeFirstOrThrow();
  if (existingPending.count !== 0)
    throw new Error(
      "Refusing local verification while unrelated SCORM ingestion work is pending",
    );
  const [workCounts, deadLetterCounts] = await Promise.all([
    getQueueCounts(env.SQS_QUEUE_URL),
    getQueueCounts(env.SQS_DEAD_LETTER_QUEUE_URL),
  ]);
  if (queueTotal(workCounts) !== 0 || queueTotal(deadLetterCounts) !== 0)
    throw new Error(
      "Refusing local verification while either ElasticMQ queue contains unrelated messages",
    );
  ownsLocalQueues = true;
  await verifyDeadLetterRedrive();

  const administrator = await database
    .selectFrom("user")
    .innerJoin("platform_admin", "platform_admin.userId", "user.id")
    .select("user.id")
    .where("user.email", "=", "admin@example.com")
    .executeTakeFirst();
  if (!administrator)
    throw new Error("Seed admin@example.com before local SCORM verification");

  for (const fixturePath of fixturePaths) {
    const archive = await readFile(fixturePath);
    staged.push(
      await stageScormPackageArchive({
        actorUserId: administrator.id,
        archive,
        title: basename(fixturePath, ".zip"),
      }),
    );
  }

  for (let remaining = staged.length; remaining > 0; remaining -= 1) {
    const dispatch = await dispatchNextOutboxEvent();
    assert.equal(dispatch.status, "dispatched");
  }
  const processed = new Set<string>();
  while (processed.size < staged.length) {
    const consumption = await consumeNextScormMessage();
    assert.notEqual(consumption.status, "no-work");
    assert.notEqual(consumption.status, "retry");
    if (consumption.status !== "processed") continue;
    assert.equal(consumption.outcome.status, "ready");
    processed.add(consumption.packageVersionId);
  }

  for (const item of staged) {
    const version = await database
      .selectFrom("scorm_package_version")
      .select([
        "status",
        "launchPath",
        "contentPrefix",
        "failureCode",
        "processedAt",
      ])
      .where("id", "=", item.packageVersionId)
      .executeTakeFirstOrThrow();
    assert.equal(version.status, "ready");
    assert.equal(version.failureCode, null);
    assert.ok(version.processedAt);
    assert.equal(version.launchPath, "scormdriver/indexAPI.html");
    const launch = await getObjectBytes(
      env.S3_LEARNING_CONTENT_BUCKET,
      `${version.contentPrefix}/${version.launchPath}`,
      5 * 1024 * 1024,
    );
    assert.ok(launch.byteLength > 0);
    assert.deepEqual(
      await ingestScormPackageVersion(
        item.packageVersionId,
        item.quarantineKey,
      ),
      { status: "already-ready" },
    );
  }

  const first = staged[0];
  assert.ok(first);
  const duplicateMessage: ScormIngestionWorkMessage = {
    version: 1,
    eventId: `duplicate_${randomUUID()}`,
    topic: SCORM_INGESTION_TOPIC,
    aggregateId: first.packageVersionId,
    payload: {
      packageVersionId: first.packageVersionId,
      quarantineKey: first.quarantineKey,
    },
  };
  await sendQueueMessage(JSON.stringify(duplicateMessage));
  const duplicate = await consumeNextScormMessage();
  assert.equal(duplicate.status, "processed");
  assert.equal(duplicate.outcome.status, "already-ready");

  const finalCounts = await getQueueCounts(env.SQS_QUEUE_URL);
  assert.equal(queueTotal(finalCounts), 0);
  console.log(
    `Verified ${String(staged.length)} real SCORM 1.2 packages through PostgreSQL outbox, ElasticMQ, quarantine, immutable extraction, idempotent redelivery and DLQ redrive`,
  );
} finally {
  await cleanup();
  destroyQueueClient();
  await destroyDatabase();
}
