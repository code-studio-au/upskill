import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import { provisionUser } from "#/server/identity/provisional-user.server";
import { deliverNotification } from "#/server/notifications/notification-delivery.server";
import { NOTIFICATION_DELIVERY_TOPIC } from "#/server/queue/work-message";

const database = getDatabase();
const suffix = randomUUID();
const actorId = `verify_provisional_actor_${suffix}`;
const email = `provisional-${suffix}@example.com`;
const sourceEventId = `verify_source_${suffix}`;

try {
  const now = new Date();
  await database
    .insertInto("user")
    .values({
      id: actorId,
      name: "Provisioning verifier",
      email: `provisioning-actor-${suffix}@example.com`,
      emailVerified: true,
      image: null,
      stripeCustomerId: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();

  const first = await database.transaction().execute(async (transaction) =>
    provisionUser(transaction, {
      name: "  Provisional Learner  ",
      email: `  ${email.toUpperCase()}  `,
      source: "administrator",
      actorUserId: actorId,
      sourceEventId,
      createdAt: now,
    }),
  );
  assert.equal(first.created, true);
  assert.equal(first.user.name, "Provisional Learner");
  assert.equal(first.user.email, email);
  assert.ok(first.notificationId);

  const second = await database.transaction().execute(async (transaction) =>
    provisionUser(transaction, {
      name: "A different name must not overwrite the account",
      email,
      source: "administrator",
      actorUserId: actorId,
      sourceEventId,
    }),
  );
  assert.equal(second.created, false);
  assert.equal(second.user.id, first.user.id);
  assert.equal(second.user.name, "Provisional Learner");
  assert.equal(second.notificationId, null);

  const storedUser = await database
    .selectFrom("user")
    .select([
      "accountState",
      "provisioningSource",
      "provisionedByUserId",
      "setupRequestedAt",
    ])
    .where("id", "=", first.user.id)
    .executeTakeFirstOrThrow();
  assert.equal(storedUser.accountState, "provisional");
  assert.equal(storedUser.provisioningSource, "administrator");
  assert.equal(storedUser.provisionedByUserId, actorId);
  assert.ok(storedUser.setupRequestedAt);

  const notifications = await database
    .selectFrom("notification")
    .selectAll()
    .where("recipientUserId", "=", first.user.id)
    .execute();
  assert.equal(notifications.length, 1);
  const notification = notifications[0];
  assert.ok(notification);
  assert.equal(notification.status, "pending");
  const outbox = await database
    .selectFrom("outbox_event")
    .select(["topic", "aggregateId", "payload"])
    .where("aggregateId", "=", notification.id)
    .executeTakeFirstOrThrow();
  assert.equal(outbox.topic, NOTIFICATION_DELIVERY_TOPIC);
  assert.equal(outbox.aggregateId, notification.id);
  assert.deepEqual(outbox.payload, { notificationId: notification.id });

  assert.deepEqual(await deliverNotification(notification.id), {
    status: "delivered",
  });
  assert.deepEqual(await deliverNotification(notification.id), {
    status: "already-delivered",
  });
  const delivered = await database
    .selectFrom("notification")
    .select(["status", "attempts", "deliveredAt"])
    .where("id", "=", notification.id)
    .executeTakeFirstOrThrow();
  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.attempts, 1);
  assert.ok(delivered.deliveredAt);
  const deliveryAttemptCount = await database
    .selectFrom("notification_delivery_attempt")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("notificationId", "=", notification.id)
    .executeTakeFirstOrThrow();
  assert.equal(String(deliveryAttemptCount.count), "1");
  const capturedEmailCount = await database
    .selectFrom("email_delivery_capture")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("notificationId", "=", notification.id)
    .executeTakeFirstOrThrow();
  assert.equal(String(capturedEmailCount.count), "1");

  const rolledBackEmail = `rolled-back-${suffix}@example.com`;
  await assert.rejects(
    database.transaction().execute(async (transaction) => {
      await provisionUser(transaction, {
        name: "Rolled Back Learner",
        email: rolledBackEmail,
        source: "administrator",
        actorUserId: actorId,
        sourceEventId: `rolled_back_${suffix}`,
      });
      throw new Error("ROLL_BACK_VERIFICATION");
    }),
    /ROLL_BACK_VERIFICATION/u,
  );
  const rolledBackCount = await database
    .selectFrom("user")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("email", "=", rolledBackEmail)
    .executeTakeFirstOrThrow();
  assert.equal(String(rolledBackCount.count), "0");

  console.log(
    "Verified provisional-user idempotency, transactional rollback and local notification delivery",
  );
} finally {
  await destroyDatabase();
}
