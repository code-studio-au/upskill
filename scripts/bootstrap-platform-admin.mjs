import { randomUUID } from "node:crypto";
import { Client } from "pg";

const usage =
  "Usage: node scripts/bootstrap-platform-admin.mjs --email <verified-account-email>";
const arguments_ = process.argv.slice(2);
if (arguments_.length !== 2 || arguments_[0] !== "--email")
  throw new Error(usage);
const email = arguments_[1]?.trim().toLowerCase();
if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
  throw new Error("A valid account email is required");

const applicationEnvironment = process.env.APP_ENV ?? "development";
if (
  (applicationEnvironment === "staging" ||
    applicationEnvironment === "production") &&
  !process.env.MIGRATION_DATABASE_URL
)
  throw new Error(
    "MIGRATION_DATABASE_URL is required to bootstrap a deployed environment",
  );
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");

const auditAction = "authorization.platform_admin.bootstrapped";
const database = new Client({ connectionString: databaseUrl });
try {
  await database.connect();
  await database.query("begin isolation level serializable");
  try {
    await database.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["upskill.bootstrap-platform-admin.v1"],
    );
    const userResult = await database.query(
      `select id, email, "emailVerified", "accountState"
         from "user"
        where lower(email) = $1`,
      [email],
    );
    if (userResult.rowCount !== 1)
      throw new Error(
        userResult.rowCount === 0
          ? `No account exists for ${email}`
          : `Multiple accounts unexpectedly match ${email}`,
      );
    const user = userResult.rows[0];
    const administratorResult = await database.query(
      `select "userId" from platform_admin order by "createdAt", "userId"`,
    );
    const targetIsAdministrator = administratorResult.rows.some(
      (row) => row.userId === user.id,
    );
    if (targetIsAdministrator) {
      await database.query("commit");
      console.log(`Platform administrator already configured for ${email}`);
    } else {
      if (administratorResult.rowCount !== 0)
        throw new Error(
          "Platform administration is already configured; bootstrap is permanently disabled",
        );
      const priorBootstrap = await database.query(
        "select 1 from audit_event where action = $1 limit 1",
        [auditAction],
      );
      if (priorBootstrap.rowCount !== 0)
        throw new Error(
          "The one-time platform-administrator bootstrap has already been used",
        );
      if (!user.emailVerified)
        throw new Error("The bootstrap account must have a verified email");
      if (user.accountState !== "active")
        throw new Error("The bootstrap account must be active");

      const createdAt = new Date();
      const auditId = `audit_${randomUUID()}`;
      await database.query(
        `insert into platform_admin ("userId", "grantedByUserId", "createdAt")
         values ($1, null, $2)`,
        [user.id, createdAt],
      );
      await database.query(
        `insert into audit_event
          (id, "actorUserId", action, "subjectType", "subjectId", reason, metadata, "createdAt")
         values ($1, null, $2, 'user', $3, 'first_environment_bootstrap', $4::jsonb, $5)`,
        [
          auditId,
          auditAction,
          user.id,
          JSON.stringify({ method: "one_time_operator" }),
          createdAt,
        ],
      );
      await database.query(
        `insert into outbox_event
          (id, topic, "aggregateId", payload, "availableAt", "processedAt", "createdAt")
         values ($1, 'audit.log_requested', $2, $3::jsonb, $4, null, $4)`,
        [
          `outbox_${randomUUID()}`,
          user.id,
          JSON.stringify({
            version: 1,
            eventId: auditId,
            event: auditAction,
            actorUserId: null,
            entityType: "user",
            entityId: user.id,
            aggregateId: user.id,
            outcome: "succeeded",
            reasonCode: "first_environment_bootstrap",
          }),
          createdAt,
        ],
      );
      await database.query("commit");
      console.log(`Bootstrapped platform administrator ${email}`);
    }
  } catch (error) {
    await database.query("rollback");
    throw error;
  }
} finally {
  await database.end();
}
