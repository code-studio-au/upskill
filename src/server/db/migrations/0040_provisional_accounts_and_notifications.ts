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
  'coordination_region.retired', 'coordination_region.reactivated'
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
  'user.provisional_created'
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
  await sql`alter table "user"
    add column "accountState" text not null default 'active',
    add column "provisioningSource" text,
    add column "provisionedByUserId" text references "user"(id) on delete set null,
    add column "setupRequestedAt" timestamptz`.execute(db);
  await sql`alter table "user"
    add constraint user_account_state_ck check ("accountState" in ('provisional', 'active')),
    add constraint user_provisioning_source_ck check ("provisioningSource" is null or "provisioningSource" in ('administrator', 'open_entry', 'late_invitation', 'access_owner')),
    add constraint user_provisioning_state_ck check (
      "accountState" = 'active'
      or ("provisioningSource" is not null and "setupRequestedAt" is not null)
    )`.execute(db);
  await sql`create unique index user_email_normalized_uq on "user" (lower(email))`.execute(
    db,
  );

  await sql`create table notification (
    id text primary key,
    channel text not null,
    "templateKey" text not null,
    "recipientUserId" text not null references "user"(id) on delete restrict,
    "recipientName" text not null,
    "recipientEmail" text not null,
    status text not null default 'pending',
    "deduplicationKey" text not null unique,
    payload jsonb not null default '{}'::jsonb,
    attempts integer not null default 0,
    "lastErrorCode" text,
    "deliveredAt" timestamptz,
    "createdAt" timestamptz not null default now(),
    "updatedAt" timestamptz not null default now(),
    constraint notification_channel_ck check (channel in ('email')),
    constraint notification_template_ck check ("templateKey" in ('account_setup_requested')),
    constraint notification_status_ck check (status in ('pending', 'delivered', 'failed')),
    constraint notification_delivery_state_ck check (
      (status = 'delivered' and "deliveredAt" is not null)
      or (status <> 'delivered' and "deliveredAt" is null)
    )
  )`.execute(db);
  await sql`create index notification_pending_idx on notification ("createdAt", id) where status in ('pending', 'failed')`.execute(
    db,
  );

  await sql`create table notification_delivery_attempt (
    id text primary key,
    "notificationId" text not null references notification(id) on delete cascade,
    attempt integer not null,
    provider text not null,
    status text not null,
    "providerMessageId" text,
    "errorCode" text,
    "createdAt" timestamptz not null default now(),
    constraint notification_delivery_attempt_number_ck check (attempt > 0),
    constraint notification_delivery_attempt_status_ck check (status in ('delivered', 'failed')),
    constraint notification_delivery_attempt_result_ck check (
      (status = 'delivered' and "providerMessageId" is not null and "errorCode" is null)
      or (status = 'failed' and "providerMessageId" is null and "errorCode" is not null)
    ),
    unique ("notificationId", attempt)
  )`.execute(db);

  await sql`create table email_delivery_capture (
    "notificationId" text primary key references notification(id) on delete cascade,
    "recipientEmail" text not null,
    subject text not null,
    "textBody" text not null,
    "createdAt" timestamptz not null default now()
  )`.execute(db);

  await replaceAuditActions(db, nextAuditActions);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await replaceAuditActions(db, previousAuditActions);
  await sql`drop table email_delivery_capture`.execute(db);
  await sql`drop table notification_delivery_attempt`.execute(db);
  await sql`drop table notification`.execute(db);
  await sql`drop index user_email_normalized_uq`.execute(db);
  await sql`alter table "user"
    drop constraint user_provisioning_state_ck,
    drop constraint user_provisioning_source_ck,
    drop constraint user_account_state_ck,
    drop column "setupRequestedAt",
    drop column "provisionedByUserId",
    drop column "provisioningSource",
    drop column "accountState"`.execute(db);
}
