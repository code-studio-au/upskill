import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "#/server/db/types";
import { withAuditMaintenance } from "./audit-maintenance";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const users = {
  administrator: {
    id: "verify_platform_admin_bootstrap_administrator",
    name: "Bootstrap Administrator",
    email: "bootstrap-administrator@codestudio.au",
    emailVerified: true,
    image: null,
    stripeCustomerId: null,
  },
  other: {
    id: "verify_platform_admin_bootstrap_other",
    name: "Other Verified User",
    email: "bootstrap-other@codestudio.au",
    emailVerified: true,
    image: null,
    stripeCustomerId: null,
  },
  unverified: {
    id: "verify_platform_admin_bootstrap_unverified",
    name: "Unverified User",
    email: "bootstrap-unverified@codestudio.au",
    emailVerified: false,
    image: null,
    stripeCustomerId: null,
  },
} as const;
const userIds = Object.values(users).map((user) => user.id);
const auditAction = "authorization.platform_admin.bootstrapped" as const;
const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

function bootstrap(email: string) {
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
  await withAuditMaintenance(database, async (transaction) => {
    await transaction
      .deleteFrom("outbox_event")
      .where("aggregateId", "in", userIds)
      .execute();
    await transaction
      .deleteFrom("audit_event")
      .where("subjectId", "in", userIds)
      .execute();
    await transaction
      .deleteFrom("platform_admin")
      .where("userId", "in", userIds)
      .execute();
    await transaction.deleteFrom("user").where("id", "in", userIds).execute();
  });
}

try {
  await cleanup();
  await database.insertInto("user").values(Object.values(users)).execute();

  const unverified = bootstrap(users.unverified.email);
  assert.notEqual(unverified.status, 0);
  assert.match(unverified.stderr, /must have a verified email/u);

  const first = bootstrap(users.administrator.email.toUpperCase());
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Bootstrapped platform administrator/u);

  const retry = bootstrap(users.administrator.email);
  assert.equal(retry.status, 0, retry.stderr);
  assert.match(retry.stdout, /already configured/u);

  const replacement = bootstrap(users.other.email);
  assert.notEqual(replacement.status, 0);
  assert.match(replacement.stderr, /bootstrap is permanently disabled/u);

  const administrator = await database
    .selectFrom("platform_admin")
    .selectAll()
    .executeTakeFirstOrThrow();
  assert.equal(administrator.userId, users.administrator.id);
  assert.equal(administrator.grantedByUserId, null);

  const audit = await database
    .selectFrom("audit_event")
    .selectAll()
    .where("action", "=", auditAction)
    .execute();
  assert.equal(audit.length, 1);
  const auditEvent = audit[0];
  assert.ok(auditEvent);
  assert.equal(auditEvent.actorUserId, null);
  assert.equal(auditEvent.subjectId, users.administrator.id);
  assert.equal(auditEvent.reason, "first_environment_bootstrap");

  const outbox = await database
    .selectFrom("outbox_event")
    .select(["topic", "aggregateId", "payload"])
    .where("aggregateId", "=", users.administrator.id)
    .executeTakeFirstOrThrow();
  assert.equal(outbox.topic, "audit.log_requested");
  assert.equal(outbox.aggregateId, users.administrator.id);
  assert.deepEqual(outbox.payload, {
    version: 1,
    eventId: auditEvent.id,
    event: auditAction,
    actorUserId: null,
    entityType: "user",
    entityId: users.administrator.id,
    aggregateId: users.administrator.id,
    outcome: "succeeded",
    reasonCode: "first_environment_bootstrap",
  });

  console.log("Verified one-time audited platform-administrator bootstrap");
} finally {
  await cleanup();
  await database.destroy();
}
