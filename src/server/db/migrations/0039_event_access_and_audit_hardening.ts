import { sql, type Kysely } from "kysely";

const currentActions = sql.raw(`
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
  'event_occurrence.lifecycle_changed', 'event_occurrence.rescheduled', 'event_attendance.recorded',
  'event_registration.submitted', 'event_registration.administrator_added',
  'event_registration.coordinator_reviewed', 'event_registration.final_decided',
  'event_registration.withdrawn', 'event_region_review.locked',
  'event_template.created', 'event_template.version_created', 'event_template.version_published',
  'event_staff.eligibility_granted', 'event_staff.eligibility_revoked',
  'coordination_region.created', 'coordination_region.updated',
  'coordination_region.retired', 'coordination_region.reactivated'
`);

const hardenedActions = sql.raw(`
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
  'event_occurrence.lifecycle_changed', 'event_occurrence.rescheduled', 'event_attendance.recorded',
  'event_registration.submitted', 'event_registration.administrator_added',
  'event_registration.coordinator_reviewed', 'event_registration.final_decided',
  'event_registration.withdrawn', 'event_region_review.locked',
  'event_template.created', 'event_template.draft_deleted', 'event_template.version_created',
  'event_template.version_published', 'event_staff.eligibility_granted', 'event_staff.eligibility_revoked',
  'coordination_region.created', 'coordination_region.updated',
  'coordination_region.retired', 'coordination_region.reactivated'
`);

async function replaceAttemptContext(
  db: Kysely<unknown>,
  includeRegistrationState: boolean,
) {
  await sql`drop view if exists scorm_attempt_context`.execute(db);
  if (includeRegistrationState)
    await sql`create view scorm_attempt_context as
      select attempt.id as "attemptId",
        coalesce(enrollment."userId", participation."userId") as "userId",
        attempt."enrollmentId",
        enrollment.status as "enrollmentStatus",
        enrollment."expiresAt" as "enrollmentExpiresAt",
        enrollment."removedAt",
        attempt."eventParticipationId",
        occurrence.status as "occurrenceStatus",
        participation.mode as "participationMode",
        registration.status as "registrationStatus"
      from scorm_attempt attempt
      left join enrollment on enrollment.id = attempt."enrollmentId"
      left join event_participation participation on participation.id = attempt."eventParticipationId"
      left join event_registration registration on registration.id = participation."registrationId"
      left join event_occurrence occurrence on occurrence.id = participation."eventOccurrenceId"`.execute(
      db,
    );
  else
    await sql`create view scorm_attempt_context as
      select attempt.id as "attemptId",
        coalesce(enrollment."userId", participation."userId") as "userId",
        attempt."enrollmentId",
        enrollment.status as "enrollmentStatus",
        enrollment."expiresAt" as "enrollmentExpiresAt",
        enrollment."removedAt",
        attempt."eventParticipationId",
        occurrence.status as "occurrenceStatus"
      from scorm_attempt attempt
      left join enrollment on enrollment.id = attempt."enrollmentId"
      left join event_participation participation on participation.id = attempt."eventParticipationId"
      left join event_occurrence occurrence on occurrence.id = participation."eventOccurrenceId"`.execute(
      db,
    );
}

async function replaceAuditActions(
  db: Kysely<unknown>,
  actions: ReturnType<typeof sql.raw>,
) {
  await sql`alter table audit_event drop constraint audit_event_action_known_ck`.execute(
    db,
  );
  await sql`alter table audit_event add constraint audit_event_action_known_ck check (action in (${actions}))`.execute(
    db,
  );
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await replaceAttemptContext(db, true);
  await replaceAuditActions(db, hardenedActions);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await replaceAttemptContext(db, false);
  await replaceAuditActions(db, currentActions);
}
