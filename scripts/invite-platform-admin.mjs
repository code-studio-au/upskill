import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";

const usage =
  "Usage: node scripts/invite-platform-admin.mjs --name <name> --email <email>";
const arguments_ = process.argv.slice(2);
if (
  arguments_.length !== 4 ||
  arguments_[0] !== "--name" ||
  arguments_[2] !== "--email"
)
  throw new Error(usage);
const name = arguments_[1]?.trim();
const email = arguments_[3]?.trim().toLowerCase();
if (!name || name.length > 200) throw new Error("A valid name is required");
if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
  throw new Error("A valid account email is required");

const applicationEnvironment = process.env.APP_ENV ?? "development";
if (
  (applicationEnvironment === "staging" ||
    applicationEnvironment === "production") &&
  !process.env.MIGRATION_DATABASE_URL
)
  throw new Error(
    "MIGRATION_DATABASE_URL is required to invite a deployed administrator",
  );
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");
const appOrigin = new URL(process.env.APP_ORIGIN ?? "http://localhost:3000");
if (
  (applicationEnvironment === "staging" ||
    applicationEnvironment === "production") &&
  appOrigin.protocol !== "https:"
)
  throw new Error("A deployed administrator invitation requires HTTPS");

const bootstrapAuditAction = "authorization.platform_admin.bootstrapped";
const notificationTopic = "notification.delivery_requested";
const auditTopic = "audit.log_requested";
const database = new Client({ connectionString: databaseUrl });

async function recordAuditEvent(client, input) {
  const auditId = `audit_${randomUUID()}`;
  await client.query(
    `insert into audit_event
      (id, "actorUserId", action, "subjectType", "subjectId", reason, metadata, "createdAt")
     values ($1, null, $2, 'user', $3, 'first_environment_bootstrap', $4::jsonb, $5)`,
    [
      auditId,
      input.action,
      input.userId,
      JSON.stringify(input.metadata),
      input.createdAt,
    ],
  );
  await client.query(
    `insert into outbox_event
      (id, topic, "aggregateId", payload, "availableAt", "processedAt", "createdAt")
     values ($1, $2, $3, $4::jsonb, $5, null, $5)`,
    [
      `outbox_${randomUUID()}`,
      auditTopic,
      input.userId,
      JSON.stringify({
        version: 1,
        eventId: auditId,
        event: input.action,
        actorUserId: null,
        entityType: "user",
        entityId: input.userId,
        aggregateId: input.userId,
        outcome: "succeeded",
        reasonCode: "first_environment_bootstrap",
      }),
      input.createdAt,
    ],
  );
}

try {
  await database.connect();
  await database.query("begin isolation level serializable");
  try {
    await database.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["upskill.bootstrap-platform-admin.v1"],
    );
    const administrator = await database.query(
      `select "userId" from platform_admin limit 1`,
    );
    const priorBootstrap = await database.query(
      "select 1 from audit_event where action = $1 limit 1",
      [bootstrapAuditAction],
    );
    if (administrator.rowCount !== 0 || priorBootstrap.rowCount !== 0)
      throw new Error(
        "Platform administration is already configured; invitation is permanently disabled",
      );

    const existing = await database.query(
      `select id, "emailVerified", "accountState"
         from "user"
        where lower(email) = $1
        for update`,
      [email],
    );
    if (existing.rowCount > 1)
      throw new Error(`Multiple accounts unexpectedly match ${email}`);
    const existingUser = existing.rows[0];
    if (existingUser?.accountState === "active") {
      if (!existingUser.emailVerified)
        throw new Error("The existing active account has an unverified email");
      await database.query("commit");
      console.log(
        `Verified account is ready for administrator bootstrap: ${email}`,
      );
    } else {
      const createdAt = new Date();
      const userId = existingUser?.id ?? `user_${randomUUID()}`;
      let auditAction;
      let auditMetadata;
      if (existingUser) {
        await database.query(
          `delete from verification
            where value = $1 and identifier like 'reset-password:%'`,
          [userId],
        );
        await database.query(
          `update notification
              set status = 'superseded', payload = '{"version":1}'::jsonb,
                  "supersededAt" = $2, "lastErrorCode" = null, "updatedAt" = $2
            where "recipientUserId" = $1
              and "templateKey" = 'account_setup_requested'
              and status in ('pending', 'processing', 'failed')`,
          [userId, createdAt],
        );
        await database.query(
          `update "user"
              set name = $2, "setupRequestedAt" = $3, "updatedAt" = $3
            where id = $1`,
          [userId, name, createdAt],
        );
        auditAction = "user.account_setup_resent";
        auditMetadata = { method: "one_time_operator" };
      } else {
        await database.query(
          `insert into "user"
            (id, name, email, "emailVerified", image, "stripeCustomerId",
             "accountState", "provisioningSource", "provisionedByUserId",
             "setupRequestedAt", "activatedAt", "createdAt", "updatedAt")
           values ($1, $2, $3, false, null, null, 'provisional',
                   'administrator', null, $4, null, $4, $4)`,
          [userId, name, email, createdAt],
        );
        auditAction = "user.provisional_created";
        auditMetadata = {
          source: "administrator",
          method: "one_time_operator",
        };
      }

      const token = randomBytes(32).toString("base64url");
      await database.query(
        `insert into verification
          (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
         values ($1, $2, $3, $4, $5, $5)`,
        [
          `verification_${randomUUID()}`,
          `reset-password:${token}`,
          userId,
          new Date(createdAt.getTime() + 72 * 60 * 60 * 1_000),
          createdAt,
        ],
      );
      const setupUrl = new URL("/account/setup", appOrigin);
      setupUrl.hash = new URLSearchParams({ token }).toString();
      const design = await database.query(
        `select version.id, version.subject, version."textBody"
           from email_design design
           join email_design_version version
             on version.id = design."activeVersionId"
          where design."systemKey" = 'account_setup_requested'
            and design.catalogue = 'system'
            and version."publishedAt" is not null`,
      );
      if (design.rowCount !== 1)
        throw new Error(
          "The published account-setup email design is unavailable",
        );
      const emailDesign = design.rows[0];
      const notificationId = `notification_${randomUUID()}`;
      await database.query(
        `insert into notification
          (id, channel, "templateKey", "recipientUserId", "recipientName",
           "recipientEmail", "emailDesignVersionId", "subjectTemplateSnapshot",
           "textBodyTemplateSnapshot", "deduplicationKey", payload,
           "lastErrorCode", "deliveredAt", "supersededAt", "renderedSubject",
           "renderedTextBody", "renderedHtmlBody", "renderedAt", "createdAt", "updatedAt")
         values ($1, 'email', 'account_setup_requested', $2, $3, $4, $5, $6,
                 $7, $8, $9::jsonb, null, null, null, null, null, null, null, $10, $10)`,
        [
          notificationId,
          userId,
          name,
          email,
          emailDesign.id,
          emailDesign.subject,
          emailDesign.textBody,
          `account-setup:bootstrap:${randomUUID()}:${userId}`,
          JSON.stringify({ version: 1, setupUrl: setupUrl.toString() }),
          createdAt,
        ],
      );
      await database.query(
        `insert into outbox_event
          (id, topic, "aggregateId", payload, "availableAt", "processedAt", "createdAt")
         values ($1, $2, $3, $4::jsonb, $5, null, $5)`,
        [
          `outbox_${randomUUID()}`,
          notificationTopic,
          notificationId,
          JSON.stringify({ notificationId }),
          createdAt,
        ],
      );
      await recordAuditEvent(database, {
        action: auditAction,
        userId,
        metadata: auditMetadata,
        createdAt,
      });
      await database.query("commit");
      console.log(
        `Queued platform administrator setup invitation for ${email}`,
      );
    }
  } catch (error) {
    await database.query("rollback");
    throw error;
  }
} finally {
  await database.end();
}
