import { sql, type Kysely } from "kysely";

const actions = sql.raw(`
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
  'event_attendance.recorded', 'event_registration.submitted',
  'event_registration.administrator_added', 'event_registration.coordinator_reviewed',
  'event_registration.final_decided', 'event_registration.withdrawn', 'event_region_review.locked',
  'event_template.created', 'event_template.version_created', 'event_template.version_published'
`);

const withoutAttendance = sql.raw(`
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
  'event_registration.submitted', 'event_registration.administrator_added',
  'event_registration.coordinator_reviewed', 'event_registration.final_decided',
  'event_registration.withdrawn', 'event_region_review.locked',
  'event_template.created', 'event_template.version_created', 'event_template.version_published'
`);

async function replace(
  db: Kysely<unknown>,
  values: ReturnType<typeof sql.raw>,
) {
  await sql`alter table audit_event drop constraint audit_event_action_known_ck`.execute(
    db,
  );
  await sql`alter table audit_event add constraint audit_event_action_known_ck check (action in (${values}))`.execute(
    db,
  );
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await replace(db, actions);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await replace(db, withoutAttendance);
}
