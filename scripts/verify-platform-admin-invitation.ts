import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { auth } from "#/server/auth/auth.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import { findAccountSetupRequest } from "#/server/identity/account-setup.server";
import { withAuditMaintenance } from "./audit-maintenance";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const suffix = randomUUID();
const email = `bootstrap-invitation-${suffix}@codestudio.au`;
const database = getDatabase();

function invite() {
  return spawnSync(
    process.execPath,
    [
      "scripts/invite-platform-admin.mjs",
      "--name",
      "Bootstrap Invitation Verifier",
      "--email",
      email,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        APP_ENV: "test",
        APP_ORIGIN: "http://127.0.0.1:3000",
        DATABASE_URL: databaseUrl,
        MIGRATION_DATABASE_URL: databaseUrl,
      },
    },
  );
}

function bootstrap() {
  return spawnSync(
    process.execPath,
    ["scripts/bootstrap-platform-admin.mjs", "--email", email],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        APP_ENV: "test",
        DATABASE_URL: databaseUrl,
        MIGRATION_DATABASE_URL: databaseUrl,
      },
    },
  );
}

async function cleanup(): Promise<void> {
  const user = await database
    .selectFrom("user")
    .select("id")
    .where("email", "=", email)
    .executeTakeFirst();
  if (!user) return;
  const notifications = await database
    .selectFrom("notification")
    .select("id")
    .where("recipientUserId", "=", user.id)
    .execute();
  const notificationIds = notifications.map((notification) => notification.id);
  await withAuditMaintenance(database, async (transaction) => {
    if (notificationIds.length > 0) {
      await transaction
        .deleteFrom("outbox_event")
        .where("aggregateId", "in", notificationIds)
        .execute();
      await transaction
        .deleteFrom("notification")
        .where("id", "in", notificationIds)
        .execute();
    }
    await transaction
      .deleteFrom("outbox_event")
      .where("aggregateId", "=", user.id)
      .execute();
    await transaction
      .deleteFrom("audit_event")
      .where("subjectId", "=", user.id)
      .execute();
    await transaction
      .deleteFrom("platform_admin")
      .where("userId", "=", user.id)
      .execute();
    await transaction
      .deleteFrom("verification")
      .where("value", "=", user.id)
      .execute();
    await transaction
      .deleteFrom("account")
      .where("userId", "=", user.id)
      .execute();
    await transaction.deleteFrom("user").where("id", "=", user.id).execute();
  });
}

try {
  await cleanup();
  const first = invite();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Queued platform administrator setup invitation/u);
  const user = await database
    .selectFrom("user")
    .select(["id", "name", "emailVerified", "accountState"])
    .where("email", "=", email)
    .executeTakeFirstOrThrow();
  assert.equal(user.name, "Bootstrap Invitation Verifier");
  assert.equal(user.emailVerified, false);
  assert.equal(user.accountState, "provisional");
  const firstNotification = await database
    .selectFrom("notification")
    .select(["id", "status", "payload"])
    .where("recipientUserId", "=", user.id)
    .executeTakeFirstOrThrow();
  assert.equal(firstNotification.status, "pending");
  const firstSetupUrl = (firstNotification.payload as { setupUrl?: unknown })
    .setupUrl;
  assert.equal(typeof firstSetupUrl, "string");
  const firstToken = new URLSearchParams(
    new URL(firstSetupUrl as string).hash.slice(1),
  ).get("token");
  assert.ok(firstToken);
  assert.deepEqual(await findAccountSetupRequest(firstToken), {
    status: "ready",
    name: "Bootstrap Invitation Verifier",
    email,
  });

  const resend = invite();
  assert.equal(resend.status, 0, resend.stderr);
  assert.deepEqual(await findAccountSetupRequest(firstToken), {
    status: "invalid",
  });
  const notifications = await database
    .selectFrom("notification")
    .select(["id", "status", "payload"])
    .where("recipientUserId", "=", user.id)
    .orderBy("createdAt")
    .execute();
  assert.equal(notifications.length, 2);
  assert.equal(notifications[0]?.status, "superseded");
  assert.equal(notifications[1]?.status, "pending");
  const replacementSetupUrl = (
    notifications[1].payload as { setupUrl?: unknown }
  ).setupUrl;
  assert.equal(typeof replacementSetupUrl, "string");
  const replacementToken = new URLSearchParams(
    new URL(replacementSetupUrl as string).hash.slice(1),
  ).get("token");
  assert.ok(replacementToken);
  const pendingVerification = await database
    .selectFrom("verification")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("value", "=", user.id)
    .where("identifier", "like", "reset-password:%")
    .executeTakeFirstOrThrow();
  assert.equal(String(pendingVerification.count), "1");

  await auth.api.resetPassword({
    body: {
      token: replacementToken,
      newPassword: "verified-bootstrap-password",
    },
  });
  const activated = await database
    .selectFrom("user")
    .select(["emailVerified", "accountState", "activatedAt"])
    .where("id", "=", user.id)
    .executeTakeFirstOrThrow();
  assert.equal(activated.emailVerified, true);
  assert.equal(activated.accountState, "active");
  assert.ok(activated.activatedAt);
  const grant = bootstrap();
  assert.equal(grant.status, 0, grant.stderr);
  assert.match(grant.stdout, /Bootstrapped platform administrator/u);
  const administrator = await database
    .selectFrom("platform_admin")
    .select("userId")
    .where("userId", "=", user.id)
    .executeTakeFirstOrThrow();
  assert.equal(administrator.userId, user.id);
  const auditActions = await database
    .selectFrom("audit_event")
    .select("action")
    .where("subjectId", "=", user.id)
    .execute();
  assert.deepEqual(
    new Set(auditActions.map((audit) => audit.action)),
    new Set([
      "authorization.platform_admin.bootstrapped",
      "user.account_activated",
      "user.account_setup_resent",
      "user.provisional_created",
    ]),
  );
  console.log(
    "Verified password-free first-administrator invitation, resend, activation and one-time grant",
  );
} finally {
  await cleanup();
  await destroyDatabase();
}
