import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import { auth } from "#/server/auth/auth.server";
import {
  findAccountSetupRequest,
  resendAccountSetup,
} from "#/server/identity/account-setup.server";
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
  const firstSetupUrl = (notification.payload as { setupUrl?: unknown })
    .setupUrl;
  assert.equal(typeof firstSetupUrl, "string");
  const firstSetupLocation = new URL(firstSetupUrl as string);
  assert.equal(firstSetupLocation.search, "");
  const firstToken = new URLSearchParams(firstSetupLocation.hash.slice(1)).get(
    "token",
  );
  assert.ok(firstToken);
  assert.deepEqual(await findAccountSetupRequest(firstToken), {
    status: "ready",
    name: "Provisional Learner",
    email,
  });
  const outbox = await database
    .selectFrom("outbox_event")
    .select(["topic", "aggregateId", "payload"])
    .where("aggregateId", "=", notification.id)
    .executeTakeFirstOrThrow();
  assert.equal(outbox.topic, NOTIFICATION_DELIVERY_TOPIC);
  assert.equal(outbox.aggregateId, notification.id);
  assert.deepEqual(outbox.payload, { notificationId: notification.id });

  const actor = {
    id: actorId,
    name: "Provisioning verifier",
    email: `provisioning-actor-${suffix}@example.com`,
    emailVerified: true,
  };
  assert.equal(await resendAccountSetup(first.user.id, actor), "resent");
  assert.deepEqual(await findAccountSetupRequest(firstToken), {
    status: "invalid",
  });
  assert.deepEqual(await deliverNotification(notification.id), {
    status: "superseded",
  });
  const replacement = await database
    .selectFrom("notification")
    .selectAll()
    .where("recipientUserId", "=", first.user.id)
    .where("id", "!=", notification.id)
    .executeTakeFirstOrThrow();
  const replacementSetupUrl = (replacement.payload as { setupUrl?: unknown })
    .setupUrl;
  assert.equal(typeof replacementSetupUrl, "string");
  const replacementToken = new URLSearchParams(
    new URL(replacementSetupUrl as string).hash.slice(1),
  ).get("token");
  assert.ok(replacementToken);
  await database
    .updateTable("notification")
    .set({ status: "processing", attempts: 1, updatedAt: new Date() })
    .where("id", "=", replacement.id)
    .execute();
  await assert.rejects(
    deliverNotification(replacement.id),
    /EMAIL_DELIVERY_IN_PROGRESS/u,
  );
  await database
    .updateTable("notification")
    .set({ updatedAt: new Date(0) })
    .where("id", "=", replacement.id)
    .execute();
  assert.deepEqual(await deliverNotification(replacement.id), {
    status: "delivered",
  });
  assert.deepEqual(await deliverNotification(replacement.id), {
    status: "already-delivered",
  });
  const delivered = await database
    .selectFrom("notification")
    .select([
      "status",
      "attempts",
      "deliveredAt",
      "payload",
      "emailDesignVersionId",
      "renderedSubject",
      "renderedTextBody",
      "renderedHtmlBody",
      "renderedAt",
    ])
    .where("id", "=", replacement.id)
    .executeTakeFirstOrThrow();
  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.attempts, 2);
  assert.ok(delivered.deliveredAt);
  assert.deepEqual(delivered.payload, { version: 1 });
  assert.ok(delivered.emailDesignVersionId);
  assert.equal(delivered.renderedSubject, "Set up your Upskill account");
  assert.match(delivered.renderedTextBody ?? "", /Provisional Learner/u);
  assert.match(delivered.renderedHtmlBody ?? "", /<p>/u);
  assert.ok(delivered.renderedAt);
  const deliveryAttemptCount = await database
    .selectFrom("notification_delivery_attempt")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("notificationId", "=", replacement.id)
    .executeTakeFirstOrThrow();
  assert.equal(String(deliveryAttemptCount.count), "1");
  const capturedEmailCount = await database
    .selectFrom("email_delivery_capture")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("notificationId", "=", replacement.id)
    .executeTakeFirstOrThrow();
  assert.equal(String(capturedEmailCount.count), "1");

  await auth.api.resetPassword({
    body: {
      token: replacementToken,
      newPassword: "verified-local-password",
    },
  });
  assert.deepEqual(await findAccountSetupRequest(replacementToken), {
    status: "invalid",
  });
  const activated = await database
    .selectFrom("user")
    .select(["accountState", "emailVerified", "activatedAt"])
    .where("id", "=", first.user.id)
    .executeTakeFirstOrThrow();
  assert.equal(activated.accountState, "active");
  assert.equal(activated.emailVerified, true);
  assert.ok(activated.activatedAt);
  const credential = await database
    .selectFrom("account")
    .select(["providerId", "password"])
    .where("userId", "=", first.user.id)
    .where("providerId", "=", "credential")
    .executeTakeFirstOrThrow();
  assert.ok(credential.password);
  await auth.api.signInEmail({
    body: { email, password: "verified-local-password" },
  });
  assert.equal(
    await resendAccountSetup(first.user.id, actor),
    "already-active",
  );

  const invitationSetupEmail = `late-invitation-setup-${suffix}@example.com`;
  const firstInvitationId = `late_invitation_first_${suffix}`;
  const secondInvitationId = `late_invitation_second_${suffix}`;
  const firstInvitationSetup = await database
    .transaction()
    .execute(async (transaction) =>
      provisionUser(transaction, {
        name: "Late invitation setup learner",
        email: invitationSetupEmail,
        source: "late_invitation",
        actorUserId: actorId,
        sourceEventId: firstInvitationId,
        continuePath: `/event-invitation#token=${"a".repeat(43)}`,
        refreshExistingSetup: {
          reason: "late_invitation",
          preserveExistingRequests: true,
        },
        setupPurpose: "late_registration_invitation",
        eventLateRegistrationInvitationId: firstInvitationId,
      }),
    );
  const secondInvitationSetup = await database
    .transaction()
    .execute(async (transaction) =>
      provisionUser(transaction, {
        name: "Late invitation setup learner",
        email: invitationSetupEmail,
        source: "late_invitation",
        actorUserId: actorId,
        sourceEventId: secondInvitationId,
        continuePath: `/event-invitation#token=${"b".repeat(43)}`,
        refreshExistingSetup: {
          reason: "late_invitation",
          preserveExistingRequests: true,
        },
        setupPurpose: "late_registration_invitation",
        eventLateRegistrationInvitationId: secondInvitationId,
      }),
    );
  assert.equal(firstInvitationSetup.created, true);
  assert.equal(secondInvitationSetup.created, false);
  assert.equal(secondInvitationSetup.user.id, firstInvitationSetup.user.id);
  const invitationSetupNotifications = await database
    .selectFrom("notification")
    .select(["payload", "status"])
    .where("recipientUserId", "=", firstInvitationSetup.user.id)
    .where("templateKey", "=", "account_setup_requested")
    .orderBy("createdAt")
    .execute();
  assert.equal(invitationSetupNotifications.length, 2);
  assert.deepEqual(
    invitationSetupNotifications.map((entry) => entry.status),
    ["pending", "pending"],
  );
  const invitationSetupTokens = invitationSetupNotifications.map((entry) => {
    const setupUrl = (entry.payload as { setupUrl?: unknown }).setupUrl;
    assert.equal(typeof setupUrl, "string");
    const setupToken = new URLSearchParams(
      new URL(setupUrl as string).hash.slice(1),
    ).get("token");
    assert.ok(setupToken);
    return setupToken;
  });
  const firstInvitationSetupToken = invitationSetupTokens[0];
  const secondInvitationSetupToken = invitationSetupTokens[1];
  assert.ok(firstInvitationSetupToken);
  assert.ok(secondInvitationSetupToken);
  assert.equal(
    (await findAccountSetupRequest(firstInvitationSetupToken)).status,
    "ready",
  );
  assert.equal(
    (await findAccountSetupRequest(secondInvitationSetupToken)).status,
    "ready",
  );
  await auth.api.resetPassword({
    body: {
      token: firstInvitationSetupToken,
      newPassword: "late-invitation-password",
    },
  });
  assert.deepEqual(await findAccountSetupRequest(firstInvitationSetupToken), {
    status: "invalid",
  });
  assert.deepEqual(await findAccountSetupRequest(secondInvitationSetupToken), {
    status: "active",
  });

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
    "Verified provisional-user idempotency, secure setup activation, multi-invitation continuation, resend supersession, delivery claiming and transactional rollback",
  );
} finally {
  await destroyDatabase();
}
