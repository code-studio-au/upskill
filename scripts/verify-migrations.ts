import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const db = new Kysely<unknown>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});
const migrationFolder = path.resolve("src/server/db/migrations");
const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({ fs, path, migrationFolder }),
});

try {
  const migrations = await migrator.getMigrations();
  const pending = migrations.filter((migration) => !migration.executedAt);
  if (pending.length > 0)
    throw new Error(
      `Pending migrations: ${pending.map((migration) => migration.name).join(", ")}`,
    );

  const expectedTables = [
    "access_grant",
    "access_grant_domain",
    "audit_event",
    "course",
    "course_version",
    "course_version_item",
    "course_version_module",
    "course_version_section",
    "enrollment",
    "learning_item_progress",
    "learning_progress_override",
    "learning_resource",
    "learning_resource_version",
    "order",
    "order_item",
    "organization",
    "platform_admin",
    "outbox_event",
    "scorm_attempt",
    "scorm_attempt_session",
    "scorm_launch_token",
    "scorm_package",
    "scorm_package_version",
    "survey",
    "survey_version",
    "user",
  ];
  const result = await sql<{
    table_name: string;
  }>`select table_name from information_schema.tables where table_schema = 'public'`.execute(
    db,
  );
  const actual = new Set(result.rows.map((row) => row.table_name));
  const missing = expectedTables.filter((table) => !actual.has(table));
  if (missing.length > 0)
    throw new Error(`Missing tables: ${missing.join(", ")}`);

  const expectedIndexes = [
    "access_grant_code_digest_uq",
    "access_grant_domain_lookup_idx",
    "audit_event_action_created_idx",
    "audit_event_actor_created_idx",
    "audit_event_subject_created_idx",
    "course_status_idx",
    "course_version_published_lookup_idx",
    "course_version_item_module_position_uq",
    "enrollment_user_status_idx",
    "learning_progress_override_latest_idx",
    "learning_item_progress_enrollment_idx",
    "order_purchaser_status_idx",
    "scorm_attempt_enrollment_idx",
    "scorm_attempt_session_attempt_idx",
    "scorm_launch_token_attempt_idx",
  ];
  const indexResult = await sql<{
    indexname: string;
  }>`select indexname from pg_indexes where schemaname = 'public'`.execute(db);
  const actualIndexes = new Set(indexResult.rows.map((row) => row.indexname));
  const missingIndexes = expectedIndexes.filter(
    (index) => !actualIndexes.has(index),
  );
  if (missingIndexes.length > 0)
    throw new Error(`Missing indexes: ${missingIndexes.join(", ")}`);
  const ingestionColumns = await sql<{
    column_name: string;
  }>`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'scorm_package_version'`.execute(
    db,
  );
  const actualIngestionColumns = new Set(
    ingestionColumns.rows.map((row) => row.column_name),
  );
  const missingIngestionColumns = [
    "failureCode",
    "processedAt",
    "sourceBytes",
  ].filter((column) => !actualIngestionColumns.has(column));
  if (missingIngestionColumns.length > 0)
    throw new Error(
      `Missing SCORM ingestion columns: ${missingIngestionColumns.join(", ")}`,
    );

  const auditVerificationId = "verify_audit_append_only";
  const auditVerificationActorId = "verify_audit_append_only_actor";
  await db.transaction().execute(async (transaction) => {
    await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
      transaction,
    );
    await sql`delete from audit_event where id = ${auditVerificationId}`.execute(
      transaction,
    );
  });
  await sql`delete from "user" where id = ${auditVerificationActorId}`.execute(
    db,
  );
  await sql`insert into "user" (id, name, email, "emailVerified")
    values (
      ${auditVerificationActorId}, 'Audit verifier',
      'verify-audit-append-only@example.com', true
    )`.execute(db);
  await sql`insert into audit_event
    (id, "actorUserId", action, "subjectType", "subjectId", reason, metadata)
    values (
      ${auditVerificationId}, ${auditVerificationActorId}, 'scorm.package_uploaded',
      'scorm_package_version', ${auditVerificationId}, null, '{}'::jsonb
    )`.execute(db);
  try {
    await assert.rejects(
      sql`update audit_event set reason = 'changed' where id = ${auditVerificationId}`.execute(
        db,
      ),
      /audit_event is append-only/u,
    );
    await assert.rejects(
      sql`update audit_event
        set "actorUserId" = null, reason = 'changed'
        where id = ${auditVerificationId}`.execute(db),
      /audit_event is append-only/u,
    );
    await assert.rejects(
      sql`delete from audit_event where id = ${auditVerificationId}`.execute(
        db,
      ),
      /audit_event is append-only/u,
    );
    await assert.rejects(
      sql`insert into audit_event
        (id, "actorUserId", action, "subjectType", "subjectId", reason, metadata)
        values (
          'verify_audit_unknown_action', null, 'unknown.action',
          'verification', 'verify_audit_unknown_action', null, '{}'::jsonb
        )`.execute(db),
      /audit_event_action_known_ck/u,
    );
    await sql`delete from "user" where id = ${auditVerificationActorId}`.execute(
      db,
    );
    const preservedAudit = await sql<{
      actorUserId: string | null;
      reason: string | null;
    }>`select "actorUserId", reason from audit_event where id = ${auditVerificationId}`.execute(
      db,
    );
    assert.deepEqual(preservedAudit.rows, [
      { actorUserId: null, reason: null },
    ]);
  } finally {
    await db.transaction().execute(async (transaction) => {
      await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
        transaction,
      );
      await sql`delete from audit_event where id = ${auditVerificationId}`.execute(
        transaction,
      );
    });
    await sql`delete from "user" where id = ${auditVerificationActorId}`.execute(
      db,
    );
  }
  console.log(
    `Verified ${String(migrations.length)} migrations, ${String(expectedTables.length)} foundational tables and ${String(expectedIndexes.length)} required indexes`,
  );
} finally {
  await db.destroy();
}
