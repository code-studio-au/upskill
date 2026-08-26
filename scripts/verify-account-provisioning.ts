import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { auth } from "#/server/auth/auth.server";
import {
  findAdminAdministrators,
  inviteAdminLearner,
  invitePlatformAdministrator,
  removePlatformAdministrator,
} from "#/server/admin/admin-account.server";
import { grantAdminEventStaffEligibility } from "#/server/admin/admin-event.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import { provisionUser } from "#/server/identity/provisional-user.server";

const database = getDatabase();
const suffix = randomUUID();
const actor = {
  id: `verify_account_admin_${suffix}`,
  name: "Account provisioning verifier",
  email: `account-admin-${suffix}@example.com`,
  emailVerified: true,
};

try {
  const now = new Date();
  await database
    .insertInto("user")
    .values({
      ...actor,
      image: null,
      stripeCustomerId: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await database
    .insertInto("platform_admin")
    .values({
      userId: actor.id,
      grantedByUserId: null,
      createdAt: now,
    })
    .execute();

  const learnerEmail = `admin-created-learner-${suffix}@example.com`;
  const learner = await inviteAdminLearner(
    { name: "Admin-created learner", email: learnerEmail },
    actor,
  );
  assert.equal(learner.outcome, "invited");
  const resentLearner = await inviteAdminLearner(
    { name: "Ignored replacement name", email: learnerEmail },
    actor,
  );
  assert.equal(resentLearner.outcome, "resent");
  assert.equal(resentLearner.userId, learner.userId);

  const purchaserEmail = `self-purchaser-${suffix}@example.com`;
  const purchaser = await database.transaction().execute((transaction) =>
    provisionUser(transaction, {
      name: "Self purchaser",
      email: purchaserEmail,
      source: "self_purchase",
      actorUserId: null,
      sourceEventId: `self-purchase-verification-${suffix}`,
      continuePath: "/courses/clinical-leadership",
    }),
  );
  const purchaserNotification = await database
    .selectFrom("notification")
    .select("payload")
    .where("recipientUserId", "=", purchaser.user.id)
    .executeTakeFirstOrThrow();
  const purchaserSetupUrl = (
    purchaserNotification.payload as { setupUrl?: unknown }
  ).setupUrl;
  assert.equal(typeof purchaserSetupUrl, "string");
  assert.equal(
    new URLSearchParams(new URL(purchaserSetupUrl as string).hash.slice(1)).get(
      "continue",
    ),
    "/courses/clinical-leadership",
  );

  const activeAdminId = `verify_active_admin_${suffix}`;
  const activeAdminEmail = `active-admin-${suffix}@example.com`;
  await database
    .insertInto("user")
    .values({
      id: activeAdminId,
      name: "Existing verified user",
      email: activeAdminEmail,
      emailVerified: true,
      image: null,
      stripeCustomerId: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  const granted = await invitePlatformAdministrator(
    { name: "Existing verified user", email: activeAdminEmail },
    actor,
  );
  assert.deepEqual(granted, { status: "granted", userId: activeAdminId });
  assert.equal(
    (await findAdminAdministrators(actor)).administrators.some(
      (administrator) =>
        administrator.userId === activeAdminId &&
        administrator.status === "active",
    ),
    true,
  );
  assert.deepEqual(await removePlatformAdministrator(activeAdminId, actor), {
    status: "revoked",
  });

  const invitedAdminEmail = `invited-admin-${suffix}@example.com`;
  const invited = await invitePlatformAdministrator(
    { name: "Invited administrator", email: invitedAdminEmail },
    actor,
  );
  assert.equal(invited.status, "invited");
  const pending = await database
    .selectFrom("platform_admin_invitation")
    .select("id")
    .where("userId", "=", invited.userId)
    .where("acceptedAt", "is", null)
    .where("cancelledAt", "is", null)
    .executeTakeFirstOrThrow();
  const notification = await database
    .selectFrom("notification")
    .select("payload")
    .where("recipientUserId", "=", invited.userId)
    .where("templateKey", "=", "account_setup_requested")
    .orderBy("createdAt", "desc")
    .executeTakeFirstOrThrow();
  const setupUrl = (notification.payload as { setupUrl?: unknown }).setupUrl;
  assert.equal(typeof setupUrl, "string");
  const token = new URLSearchParams(
    new URL(setupUrl as string).hash.slice(1),
  ).get("token");
  assert.ok(token);
  await auth.api.resetPassword({
    body: { token, newPassword: "verified-local-password" },
  });
  const accepted = await database
    .selectFrom("platform_admin_invitation")
    .select("acceptedAt")
    .where("id", "=", pending.id)
    .executeTakeFirstOrThrow();
  assert.ok(accepted.acceptedAt);
  assert.ok(
    await database
      .selectFrom("platform_admin")
      .select("userId")
      .where("userId", "=", invited.userId)
      .executeTakeFirst(),
  );
  assert.deepEqual(await removePlatformAdministrator(invited.userId, actor), {
    status: "revoked",
  });

  const regionId = `verify_account_region_${suffix}`;
  await database
    .insertInto("coordination_region")
    .values({
      id: regionId,
      parentId: null,
      code: `V${suffix.replaceAll("-", "").slice(0, 10).toUpperCase()}`,
      name: "Provisioning region",
      kind: "operational",
      status: "active",
      createdAt: now,
    })
    .execute();
  const staffEmail = `invited-presenter-${suffix}@example.com`;
  const staff = await grantAdminEventStaffEligibility(
    {
      name: "Invited presenter",
      email: staffEmail,
      responsibility: "presenter",
      regionId: null,
    },
    actor,
  );
  assert.ok(staff);
  assert.equal(staff.accountInvited, true);
  const staffUser = await database
    .selectFrom("user")
    .select(["accountState", "provisioningSource"])
    .where("email", "=", staffEmail)
    .executeTakeFirstOrThrow();
  assert.equal(staffUser.accountState, "provisional");
  assert.equal(staffUser.provisioningSource, "administrator");

  const auditActions = await database
    .selectFrom("audit_event")
    .select("action")
    .where("subjectId", "in", [activeAdminId, invited.userId])
    .execute();
  const actions = new Set(auditActions.map((entry) => entry.action));
  assert.ok(actions.has("authorization.platform_admin.invited"));
  assert.ok(actions.has("authorization.platform_admin.granted"));
  assert.ok(actions.has("authorization.platform_admin.revoked"));

  console.log(
    "Verified admin-created learners, active and deferred administrator grants, revocation, and event-staff invitations",
  );
} finally {
  await destroyDatabase();
}
