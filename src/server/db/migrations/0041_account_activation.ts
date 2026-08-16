import { sql, type Kysely } from "kysely";

const previousAuditActions = sql.raw(`
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
  'coordination_region.retired', 'coordination_region.reactivated',
  'user.provisional_created'
`);

const nextAuditActions = sql.raw(`
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
  'coordination_region.retired', 'coordination_region.reactivated',
  'user.provisional_created', 'user.account_activated', 'user.account_setup_resent'
`);

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
  await sql`alter table "user" add column "activatedAt" timestamptz`.execute(
    db,
  );
  await sql`alter table "user" add constraint user_activation_state_ck check (
    ("accountState" = 'provisional' and "activatedAt" is null)
    or "accountState" = 'active'
  )`.execute(db);
  await sql`alter table notification
    add column "supersededAt" timestamptz,
    drop constraint notification_delivery_state_ck,
    drop constraint notification_status_ck`.execute(db);
  await sql`alter table notification
    add constraint notification_status_ck check (status in ('pending', 'processing', 'delivered', 'failed', 'superseded')),
    add constraint notification_delivery_state_ck check (
      (status = 'delivered' and "deliveredAt" is not null and "supersededAt" is null)
      or (status = 'superseded' and "deliveredAt" is null and "supersededAt" is not null)
      or (status in ('pending', 'processing', 'failed') and "deliveredAt" is null and "supersededAt" is null)
    )`.execute(db);
  await replaceAuditActions(db, nextAuditActions);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await replaceAuditActions(db, previousAuditActions);
  await sql`update notification
    set status = 'failed', "supersededAt" = null
    where status in ('processing', 'superseded')`.execute(db);
  await sql`alter table notification
    drop constraint notification_delivery_state_ck,
    drop constraint notification_status_ck`.execute(db);
  await sql`alter table notification
    add constraint notification_status_ck check (status in ('pending', 'delivered', 'failed')),
    add constraint notification_delivery_state_ck check (
      (status = 'delivered' and "deliveredAt" is not null)
      or (status <> 'delivered' and "deliveredAt" is null)
    ),
    drop column "supersededAt"`.execute(db);
  await sql`alter table "user"
    drop constraint user_activation_state_ck,
    drop column "activatedAt"`.execute(db);
}
