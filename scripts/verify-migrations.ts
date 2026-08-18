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
    "access_grant_code",
    "access_grant_domain",
    "access_grant_owner_assignment",
    "audit_event",
    "bulk_order",
    "course",
    "course_version",
    "course_version_item",
    "course_version_section",
    "coordination_region",
    "enrollment",
    "entitlement",
    "event_admin_assignment",
    "event_attendance",
    "event_coordinator_assignment",
    "event_guest_access",
    "event_occurrence",
    "event_occurrence_domain",
    "event_occurrence_region",
    "event_participation",
    "event_presenter_assignment",
    "event_region_review_round",
    "event_registration",
    "event_registration_region_decision",
    "event_section_release",
    "event_survey_access",
    "event_session",
    "event_template",
    "event_template_session_definition",
    "event_template_version",
    "event_template_version_admin_default",
    "event_template_version_coordinator_default",
    "event_template_version_item",
    "event_template_version_presenter_default",
    "event_template_version_region",
    "event_template_version_section",
    "learning_activity",
    "learning_activity_version",
    "learning_item_progress",
    "learning_progress_override",
    "learning_resource_version",
    "notification",
    "notification_delivery_attempt",
    "email_delivery_capture",
    "order",
    "order_item",
    "order_refund",
    "organization",
    "platform_admin",
    "outbox_event",
    "scorm_attempt",
    "scorm_attempt_session",
    "scorm_launch_token",
    "scorm_package_version",
    "survey_progress",
    "survey_response",
    "survey_version",
    "user",
    "event_staff_eligibility",
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
  const retiredTables = [
    "completion_certificate",
    "course_version_module",
    "learning_resource",
    "scorm_package",
    "survey",
  ];
  const retainedRetiredTables = retiredTables.filter((table) =>
    actual.has(table),
  );
  if (retainedRetiredTables.length > 0)
    throw new Error(
      `Retired tables must not remain: ${retainedRetiredTables.join(", ")}`,
    );

  const expectedIndexes = [
    "access_grant_code_lookup_id_uq",
    "access_grant_domain_lookup_idx",
    "access_grant_admin_lookup_idx",
    "audit_event_action_created_idx",
    "audit_event_actor_created_idx",
    "audit_event_subject_created_idx",
    "course_status_idx",
    "course_version_published_lookup_idx",
    "course_version_item_module_position_uq",
    "enrollment_user_status_idx",
    "event_admin_assignment_active_idx",
    "event_coordinator_assignment_active_idx",
    "event_occurrence_schedule_idx",
    "event_occurrence_slug_uq",
    "event_presenter_assignment_active_idx",
    "event_registration_selection_idx",
    "event_registration_region_decision_current_uq",
    "event_registration_region_decision_reporting_idx",
    "learning_progress_override_latest_idx",
    "learning_item_progress_enrollment_idx",
    "order_purchaser_status_idx",
    "order_refund_order_idx",
    "order_stripe_payment_intent_uq",
    "bulk_order_access_grant_idx",
    "scorm_attempt_enrollment_idx",
    "scorm_attempt_session_attempt_idx",
    "scorm_launch_token_attempt_idx",
    "survey_response_enrollment_idx",
    "survey_progress_enrollment_idx",
    "event_presenter_eligibility_active_uq",
    "event_coordinator_eligibility_active_uq",
    "coordination_region_code_unique_uq",
    "event_survey_access_active_item_uq",
    "event_guest_access_active_occurrence_uq",
    "user_email_normalized_uq",
    "notification_pending_idx",
  ];
  const indexResult = await sql<{
    indexdef: string;
    indexname: string;
  }>`select indexname, indexdef from pg_indexes where schemaname = 'public'`.execute(
    db,
  );
  const actualIndexes = new Set(indexResult.rows.map((row) => row.indexname));
  const missingIndexes = expectedIndexes.filter(
    (index) => !actualIndexes.has(index),
  );
  if (missingIndexes.length > 0)
    throw new Error(`Missing indexes: ${missingIndexes.join(", ")}`);
  const eventDirectoryConstraints = await sql<{
    constraint_name: string;
  }>`select constraint_name from information_schema.table_constraints
      where table_schema = 'public'
        and constraint_name in (
          'coordination_region_kind_ck',
          'coordination_region_code_uppercase_ck',
          'event_staff_eligibility_responsibility_ck',
          'event_staff_eligibility_revocation_ck'
        )`.execute(db);
  assert.equal(
    eventDirectoryConstraints.rows.length,
    4,
    "Event staff and region-directory constraints must exist",
  );
  const eventSurveyAccessConstraints = await sql<{
    constraint_name: string;
  }>`select constraint_name from information_schema.table_constraints
      where table_schema = 'public'
        and constraint_name in (
          'event_survey_access_public_reference_uq',
          'event_survey_access_generation_uq',
          'event_survey_access_reference_ck',
          'event_survey_access_policy_ck'
        )`.execute(db);
  assert.equal(
    eventSurveyAccessConstraints.rows.length,
    4,
    "Event Survey access identity, rotation and policy constraints must exist",
  );
  const eventGuestAccessConstraints = await sql<{
    constraint_name: string;
  }>`select constraint_name from information_schema.table_constraints
      where table_schema = 'public'
        and constraint_name in (
          'event_guest_access_public_reference_uq',
          'event_guest_access_generation_uq',
          'event_guest_access_reference_ck',
          'event_guest_access_generation_ck',
          'event_occurrence_open_entry_attendance_mode_ck'
        )`.execute(db);
  assert.equal(
    eventGuestAccessConstraints.rows.length,
    5,
    "Open-entry guest access identity, rotation and attendance constraints must exist",
  );
  const eventRegistrationReviewConstraints = await sql<{
    constraint_name: string;
  }>`select constraint_name from information_schema.table_constraints
      where table_schema = 'public'
        and constraint_name in (
          'event_registration_region_mismatch_ack_ck',
          'event_registration_regional_review_waiver_ck'
        )`.execute(db);
  assert.equal(
    eventRegistrationReviewConstraints.rows.length,
    2,
    "Event registration mismatch acknowledgement and review-waiver constraints must exist",
  );
  const eventRegistrationRegionDecisionConstraints = await sql<{
    constraint_name: string;
  }>`select constraint_name from information_schema.table_constraints
      where table_schema = 'public'
        and constraint_name in (
          'event_registration_region_decision_resolution_ck',
          'event_registration_region_decision_classification_ck',
          'event_registration_region_decision_snapshot_ck'
        )`.execute(db);
  assert.equal(
    eventRegistrationRegionDecisionConstraints.rows.length,
    3,
    "Event registration reporting-region decisions must be constrained",
  );
  const eventTemplateColumns = await sql<{
    column_name: string;
  }>`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'event_template'`.execute(
    db,
  );
  if (eventTemplateColumns.rows.some((column) => column.column_name === "slug"))
    throw new Error("Internal Event Templates must not own public URL slugs");
  const eventOccurrenceColumns = await sql<{
    column_name: string;
    is_nullable: string;
  }>`select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'event_occurrence'`.execute(
    db,
  );
  if (
    !eventOccurrenceColumns.rows.some(
      (column) => column.column_name === "slug" && column.is_nullable === "NO",
    )
  )
    throw new Error("Event occurrences must own a required public URL slug");
  for (const columnName of ["localStartsAt", "localEndsAt"]) {
    if (
      !eventOccurrenceColumns.rows.some(
        (column) =>
          column.column_name === columnName && column.is_nullable === "NO",
      )
    )
      throw new Error(
        `Event occurrences must retain required local schedule field ${columnName}`,
      );
  }
  const eventTimeConstraints = await sql<{
    constraint_name: string;
  }>`select constraint_name from information_schema.table_constraints
      where table_schema = 'public'
        and constraint_name in (
          'event_occurrence_local_schedule_ck',
          'event_session_local_schedule_ck',
          'event_reschedule_local_schedule_ck',
          'event_template_section_release_ck'
        )`.execute(db);
  assert.equal(
    eventTimeConstraints.rows.length,
    4,
    "Event local-time and release-duration constraints must exist",
  );
  const releaseColumns = await sql<{
    column_name: string;
  }>`select column_name from information_schema.columns
      where table_schema = 'public'
        and table_name = 'event_template_version_section'`.execute(db);
  const releaseColumnNames = new Set(
    releaseColumns.rows.map((column) => column.column_name),
  );
  if (
    !releaseColumnNames.has("releaseOffsetAmount") ||
    !releaseColumnNames.has("releaseOffsetUnit") ||
    releaseColumnNames.has("releaseOffsetMinutes")
  )
    throw new Error(
      "Event section releases must use explicit offset amounts and units",
    );
  const accessCodeIndex = indexResult.rows.find(
    (index) => index.indexname === "access_grant_code_lookup_id_uq",
  );
  if (!accessCodeIndex?.indexdef.includes('"lookupId"'))
    throw new Error(
      "Access-code unique index must use the public lookup identifier",
    );
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
  const activityItemColumns = await sql<{
    column_name: string;
  }>`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'course_version_item'`.execute(
    db,
  );
  const actualActivityItemColumns = new Set(
    activityItemColumns.rows.map((row) => row.column_name),
  );
  if (!actualActivityItemColumns.has("learningActivityVersionId"))
    throw new Error(
      "Course items must reference one common Learning Activity Version",
    );
  for (const legacyColumn of [
    "scormPackageVersionId",
    "surveyVersionId",
    "resourceVersionId",
  ])
    if (actualActivityItemColumns.has(legacyColumn))
      throw new Error(
        `Legacy polymorphic course-item column must be removed: ${legacyColumn}`,
      );
  const activityKinds = await sql<{
    constraint_name: string;
  }>`select constraint_name from information_schema.table_constraints
      where table_schema = 'public'
        and constraint_name in (
          'learning_activity_kind_ck',
          'learning_activity_version_activity_fk',
          'course_version_item_activity_version_fk'
        )`.execute(db);
  assert.equal(
    activityKinds.rows.length,
    3,
    "Learning Activity identity/version and course-item constraints must exist",
  );
  const accessGrantColumns = await sql<{
    column_name: string;
  }>`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'access_grant'`.execute(
    db,
  );
  const actualAccessGrantColumns = new Set(
    accessGrantColumns.rows.map((row) => row.column_name),
  );
  const missingAccessGrantColumns = ["fulfillmentMode", "codePrefix"].filter(
    (column) => !actualAccessGrantColumns.has(column),
  );
  if (missingAccessGrantColumns.length > 0)
    throw new Error(
      `Missing access-grant columns: ${missingAccessGrantColumns.join(", ")}`,
    );
  if (actualAccessGrantColumns.has("accessCodeDigest"))
    throw new Error("Legacy access-code HMAC digest column must be removed");
  if (actualAccessGrantColumns.has("accessCode"))
    throw new Error("Plaintext access-code column must be removed");
  if (
    actualAccessGrantColumns.has("accessCodeLookupId") ||
    actualAccessGrantColumns.has("encryptedAccessCode")
  )
    throw new Error(
      "Access-code envelopes must be normalized into access_grant_code",
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
