import assert from "node:assert/strict";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { withAuditMaintenance } from "./audit-maintenance";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import {
  findAdminNotificationOperations,
  requeueFailedNotification,
} from "#/server/admin/admin-notification.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  administrator: "verify_notification_operations_admin",
  learner: "verify_notification_operations_learner",
  notification: "verify_notification_operations_delivery",
  attempt: "verify_notification_operations_attempt",
};
const administrator: AuthenticatedUser = {
  id: ids.administrator,
  name: "Notification Operations Administrator",
  email: "notification-operations-admin@example.com",
  emailVerified: true,
};
const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

async function cleanup(): Promise<void> {
  await database
    .deleteFrom("outbox_event")
    .where("aggregateId", "=", ids.notification)
    .execute();
  await withAuditMaintenance(database, async (transaction) => {
    await transaction
      .deleteFrom("audit_event")
      .where("subjectId", "=", ids.notification)
      .execute();
  });
  await database
    .deleteFrom("notification")
    .where("id", "=", ids.notification)
    .execute();
  await database
    .deleteFrom("platform_admin")
    .where("userId", "=", ids.administrator)
    .execute();
  await database
    .deleteFrom("user")
    .where("id", "in", [ids.administrator, ids.learner])
    .execute();
}

try {
  await cleanup();
  const baseline = await findAdminNotificationOperations({
    q: "",
    status: "all",
    page: 1,
  });
  await database
    .insertInto("user")
    .values([
      {
        id: administrator.id,
        name: administrator.name,
        email: administrator.email,
        emailVerified: true,
        image: null,
        stripeCustomerId: null,
      },
      {
        id: ids.learner,
        name: "Notification Operations Learner",
        email: "notification-operations-learner@example.com",
        emailVerified: true,
        image: null,
        stripeCustomerId: null,
      },
    ])
    .execute();
  await database
    .insertInto("platform_admin")
    .values({ userId: administrator.id, grantedByUserId: null })
    .execute();
  const emailDesignVersion = await database
    .selectFrom("email_design as design")
    .innerJoin(
      "email_design_version as version",
      "version.id",
      "design.activeVersionId",
    )
    .select(["version.id", "version.subject", "version.textBody"])
    .where("design.systemKey", "=", "account_setup_requested")
    .executeTakeFirstOrThrow();
  const failedAt = new Date(Date.now() - 20 * 60_000);
  await database
    .insertInto("notification")
    .values({
      id: ids.notification,
      channel: "email",
      templateKey: "account_setup_requested",
      recipientUserId: ids.learner,
      recipientName: "Notification Operations Learner",
      recipientEmail: "notification-operations-learner@example.com",
      emailDesignVersionId: emailDesignVersion.id,
      subjectTemplateSnapshot: emailDesignVersion.subject,
      textBodyTemplateSnapshot: emailDesignVersion.textBody,
      status: "failed",
      deduplicationKey: "verify_notification_operations_delivery",
      payload: { version: 1, setupUrl: "https://example.com/setup/redacted" },
      attempts: 1,
      lastErrorCode: "EMAIL_PROVIDER_REJECTED",
      deliveredAt: null,
      supersededAt: null,
      renderedSubject: "Set up your account",
      renderedTextBody: "Retained but intentionally not exposed by operations.",
      renderedHtmlBody:
        "<p>Retained but intentionally not exposed by operations.</p>",
      renderedAt: failedAt,
      createdAt: failedAt,
      updatedAt: failedAt,
    })
    .execute();
  await database
    .insertInto("notification_delivery_attempt")
    .values({
      id: ids.attempt,
      notificationId: ids.notification,
      attempt: 1,
      provider: "verification",
      status: "failed",
      providerMessageId: null,
      errorCode: "EMAIL_PROVIDER_REJECTED",
      createdAt: failedAt,
    })
    .execute();

  const failedDirectory = await findAdminNotificationOperations({
    q: "notification-operations-learner@example.com",
    status: "failed",
    page: 1,
  });
  assert.equal(
    failedDirectory.health.failedNotifications,
    baseline.health.failedNotifications + 1,
  );
  assert.equal(failedDirectory.pagination.total, 1);
  const failedNotification = failedDirectory.notifications[0];
  assert.ok(failedNotification);
  assert.equal(failedNotification.id, ids.notification);
  assert.equal(failedNotification.statusLabel, "Failed");
  assert.equal(failedNotification.deliveryAttempts.length, 1);
  const failedAttempt = failedNotification.deliveryAttempts[0];
  assert.ok(failedAttempt);
  assert.equal(failedAttempt.errorCode, "EMAIL_PROVIDER_REJECTED");

  assert.equal(
    await requeueFailedNotification(ids.notification, administrator),
    "requeued",
  );
  assert.equal(
    await requeueFailedNotification(ids.notification, administrator),
    "conflict",
  );
  assert.equal(
    await requeueFailedNotification("notification_missing", administrator),
    "not-found",
  );

  const notification = await database
    .selectFrom("notification")
    .select(["status", "attempts", "lastErrorCode"])
    .where("id", "=", ids.notification)
    .executeTakeFirstOrThrow();
  assert.deepEqual(notification, {
    status: "pending",
    attempts: 1,
    lastErrorCode: null,
  });
  const deliveryOutbox = await database
    .selectFrom("outbox_event")
    .select(["topic", "payload"])
    .where("aggregateId", "=", ids.notification)
    .where("topic", "=", "notification.delivery_requested")
    .execute();
  assert.equal(deliveryOutbox.length, 1);
  assert.deepEqual(deliveryOutbox[0]?.payload, {
    notificationId: ids.notification,
  });
  const audit = await database
    .selectFrom("audit_event")
    .select(["actorUserId", "action", "subjectType", "subjectId", "metadata"])
    .where("subjectId", "=", ids.notification)
    .executeTakeFirstOrThrow();
  assert.equal(audit.actorUserId, administrator.id);
  assert.equal(audit.action, "notification.delivery_requeued");
  assert.equal(audit.subjectType, "notification");
  assert.deepEqual(audit.metadata, {
    priorAttempts: 1,
    priorErrorCode: "EMAIL_PROVIDER_REJECTED",
  });

  const pendingDirectory = await findAdminNotificationOperations({
    q: "notification-operations-learner@example.com",
    status: "pending",
    page: 1,
  });
  assert.equal(
    pendingDirectory.health.pendingNotifications,
    baseline.health.pendingNotifications + 1,
  );
  assert.ok(
    pendingDirectory.health.dueDeliveryOutbox >=
      baseline.health.dueDeliveryOutbox + 1,
  );
  assert.ok(pendingDirectory.health.oldestDueOutboxAt);
  assert.equal(pendingDirectory.pagination.total, 1);
  assert.equal(pendingDirectory.notifications[0]?.id, ids.notification);
  const scheduledFor = new Date(Date.now() + 7 * 24 * 60 * 60_000);
  await database
    .updateTable("outbox_event")
    .set({ availableAt: scheduledFor })
    .where("aggregateId", "=", ids.notification)
    .where("topic", "=", "notification.delivery_requested")
    .execute();
  const scheduledDirectory = await findAdminNotificationOperations({
    q: "notification-operations-learner@example.com",
    status: "pending",
    page: 1,
  });
  const scheduledNotification = scheduledDirectory.notifications[0];
  assert.ok(scheduledNotification);
  assert.equal(scheduledNotification.statusLabel, "Scheduled");
  assert.equal(scheduledNotification.scheduledFor, scheduledFor.toISOString());
  assert.match(scheduledNotification.detailSummary, /Scheduled for .* UTC/);
  console.log(
    "Verified notification operations health, scheduled delivery labels, filtered history, attempt detail and audited safe requeue",
  );
} finally {
  await cleanup();
  await database.destroy();
}
