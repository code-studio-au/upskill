import assert from "node:assert/strict";
import { withAuditMaintenance } from "./audit-maintenance";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import { dispatchNextOutboxEvent } from "#/server/outbox/outbox-dispatcher.server";

const database = getDatabase();
const eventId = "verify_audit_projection_event";
const rollbackEventId = "verify_audit_projection_rollback";
const subjectId = "verify_audit_projection_subject";
const verifierCreatedAt = new Date("1970-01-01T00:00:00.000Z");

async function cleanup(): Promise<void> {
  await withAuditMaintenance(database, async (transaction) => {
    await transaction
      .deleteFrom("outbox_event")
      .where("aggregateId", "=", subjectId)
      .execute();
    await transaction
      .deleteFrom("audit_event")
      .where("id", "in", [eventId, rollbackEventId])
      .execute();
  });
}

try {
  await cleanup();
  await assert.rejects(
    database.transaction().execute(async (transaction) => {
      await recordDurableAuditEvent(transaction, {
        id: rollbackEventId,
        actorUserId: null,
        action: "scorm.package_uploaded",
        subjectType: "scorm_package_version",
        subjectId,
        metadata: { sha256: "private-rollback-value" },
        createdAt: verifierCreatedAt,
      });
      throw new Error("force rollback");
    }),
    /force rollback/u,
  );
  assert.equal(
    await database
      .selectFrom("audit_event")
      .select("id")
      .where("id", "=", rollbackEventId)
      .executeTakeFirst(),
    undefined,
  );

  await database.transaction().execute(async (transaction) => {
    await recordDurableAuditEvent(transaction, {
      id: eventId,
      actorUserId: null,
      action: "scorm.package_uploaded",
      subjectType: "scorm_package_version",
      subjectId,
      metadata: { sha256: "private-committed-value" },
      createdAt: verifierCreatedAt,
    });
  });

  let output = "";
  const originalInfo = console.info;
  console.info = (message?: unknown) => {
    output = String(message);
  };
  let dispatch;
  try {
    dispatch = await dispatchNextOutboxEvent();
  } finally {
    console.info = originalInfo;
  }
  assert.deepEqual(dispatch, { status: "logged", eventId });
  const entry = JSON.parse(output) as Record<string, unknown>;
  assert.deepEqual(
    {
      category: entry.category,
      eventId: entry.eventId,
      type: entry.type,
      entityId: entry.entityId,
    },
    {
      category: "audit",
      eventId,
      type: "scorm.package_uploaded",
      entityId: subjectId,
    },
  );
  assert.doesNotMatch(output, /private-committed-value/u);
  const outbox = await database
    .selectFrom("outbox_event")
    .select("processedAt")
    .where("aggregateId", "=", subjectId)
    .executeTakeFirstOrThrow();
  assert.ok(outbox.processedAt);
  console.log(
    "Verified rollback-safe durable audit writes and committed structured-log projection",
  );
} finally {
  await cleanup();
  await destroyDatabase();
}
