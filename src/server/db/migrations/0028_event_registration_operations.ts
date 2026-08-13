import { sql, type Kysely } from "kysely";

const previousActions = sql.raw(`
  'course.archived', 'course.created', 'course.deleted', 'course.published', 'course.version_created',
  'enrollment.access_code_redeemed', 'enrollment.administrator_added', 'enrollment.administrator_removed',
  'enrollment.learning_completed', 'enrollment.purchased', 'enrollment.scorm_completed',
  'learning.progress_overridden', 'order.checkout_failed', 'order.checkout_paid', 'order.paid_existing_enrollment',
  'resource.uploaded', 'resource.version_removed', 'scorm.attempt_launch_issued', 'scorm.package_ready',
  'scorm.package_rejected', 'scorm.package_uploaded', 'scorm.package_version_removed',
  'survey.created', 'survey.published', 'survey.version_created',
  'access_grant.administrator_created', 'access_grant.administrator_revoked',
  'access_grant.administrator_capacity_updated', 'access_grant.administrator_code_revealed',
  'event_occurrence.created', 'event_occurrence.published', 'event_occurrence.updated',
  'event_registration.submitted', 'event_template.created', 'event_template.version_created',
  'event_template.version_published'
`);

const operationActions = sql.raw(`
  'event_attendance.recorded', 'event_registration.administrator_added', 'event_registration.coordinator_reviewed',
  'event_registration.final_decided', 'event_registration.withdrawn', 'event_region_review.locked'
`);

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("event_registration_transition")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventRegistrationId", "text", (column) =>
      column.notNull().references("event_registration.id").onDelete("restrict"),
    )
    .addColumn("fromStatus", "text")
    .addColumn("toStatus", "text", (column) => column.notNull())
    .addColumn("source", "text", (column) => column.notNull())
    .addColumn("actorUserId", "text", (column) =>
      column.references("user.id").onDelete("restrict"),
    )
    .addColumn("priority", "integer")
    .addColumn("occurredAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "event_registration_transition_status_ck",
      sql`("fromStatus" is null or "fromStatus" in ('submitted', 'coordinator_approved', 'coordinator_declined', 'selected', 'waitlisted', 'not_selected', 'withdrawn', 'cancelled'))
        and "toStatus" in ('submitted', 'coordinator_approved', 'coordinator_declined', 'selected', 'waitlisted', 'not_selected', 'withdrawn', 'cancelled')`,
    )
    .addCheckConstraint(
      "event_registration_transition_source_ck",
      sql`source in ('learner', 'automatic', 'coordinator', 'administrator', 'deadline')`,
    )
    .execute();

  await db.schema
    .createIndex("event_registration_transition_history_idx")
    .on("event_registration_transition")
    .columns(["eventRegistrationId", "occurredAt"])
    .execute();

  await sql`alter table audit_event drop constraint audit_event_action_known_ck`.execute(
    db,
  );
  await sql`alter table audit_event add constraint audit_event_action_known_ck
    check (action in (${previousActions}, ${operationActions}))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table audit_event drop constraint audit_event_action_known_ck`.execute(
    db,
  );
  await sql`alter table audit_event add constraint audit_event_action_known_ck
    check (action in (${previousActions}))`.execute(db);
  await db.schema.dropTable("event_registration_transition").execute();
}
