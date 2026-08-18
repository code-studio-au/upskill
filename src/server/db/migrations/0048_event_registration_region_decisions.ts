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
  'event_occurrence.guest_access_rotated',
  'event_registration.submitted', 'event_registration.administrator_added',
  'event_registration.coordinator_reviewed', 'event_registration.final_decided',
  'event_registration.withdrawn', 'event_registration.region_reassigned',
  'event_registration.region_mismatch_acknowledged', 'event_region_review.locked',
  'event_template.created', 'event_template.draft_deleted', 'event_template.version_created',
  'event_template.version_published', 'event_staff.eligibility_granted', 'event_staff.eligibility_revoked',
  'coordination_region.created', 'coordination_region.updated',
  'coordination_region.retired', 'coordination_region.reactivated',
  'user.provisional_created', 'user.account_activated', 'user.account_setup_resent',
  'user.onboarding_reassigned', 'user.region_updated'
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
  'event_occurrence.guest_access_rotated',
  'event_registration.submitted', 'event_registration.administrator_added',
  'event_registration.coordinator_reviewed', 'event_registration.final_decided',
  'event_registration.withdrawn', 'event_registration.region_reassigned',
  'event_registration.region_mismatch_acknowledged', 'event_registration.region_decided',
  'event_region_review.locked',
  'event_template.created', 'event_template.draft_deleted', 'event_template.version_created',
  'event_template.version_published', 'event_staff.eligibility_granted', 'event_staff.eligibility_revoked',
  'coordination_region.created', 'coordination_region.updated',
  'coordination_region.retired', 'coordination_region.reactivated',
  'user.provisional_created', 'user.account_activated', 'user.account_setup_resent',
  'user.onboarding_reassigned', 'user.region_updated'
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
  await db.schema
    .createTable("event_registration_region_decision")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventRegistrationId", "text", (column) =>
      column.notNull().references("event_registration.id").onDelete("restrict"),
    )
    .addColumn("registrationEventOccurrenceRegionId", "text", (column) =>
      column.references("event_occurrence_region.id").onDelete("restrict"),
    )
    .addColumn("resolution", "text", (column) => column.notNull())
    .addColumn("classification", "text", (column) => column.notNull())
    .addColumn("reportingRegionId", "text", (column) =>
      column.references("coordination_region.id").onDelete("restrict"),
    )
    .addColumn("reportingRegionCodeSnapshot", "text")
    .addColumn("reportingRegionNameSnapshot", "text")
    .addColumn("reportingRegionGroupCodeSnapshot", "text")
    .addColumn("reportingRegionGroupNameSnapshot", "text")
    .addColumn("decidedByUserId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("decidedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("supersededAt", "timestamptz")
    .addCheckConstraint(
      "event_registration_region_decision_resolution_ck",
      sql`resolution in ('registered_region_confirmed', 'profile_region_confirmed', 'profile_aligned_to_registration', 'region_guest_confirmed')`,
    )
    .addCheckConstraint(
      "event_registration_region_decision_classification_ck",
      sql`classification in ('event_region', 'outside_event_region', 'no_region_guest')`,
    )
    .addCheckConstraint(
      "event_registration_region_decision_snapshot_ck",
      sql`(
        classification = 'no_region_guest'
        and "reportingRegionId" is null
        and "reportingRegionCodeSnapshot" is null
        and "reportingRegionNameSnapshot" is null
        and "reportingRegionGroupCodeSnapshot" is null
        and "reportingRegionGroupNameSnapshot" is null
      ) or (
        classification <> 'no_region_guest'
        and "reportingRegionId" is not null
        and "reportingRegionCodeSnapshot" is not null
        and "reportingRegionNameSnapshot" is not null
      )`,
    )
    .execute();

  await sql`create unique index event_registration_region_decision_current_uq
    on event_registration_region_decision ("eventRegistrationId")
    where "supersededAt" is null`.execute(db);
  await db.schema
    .createIndex("event_registration_region_decision_reporting_idx")
    .on("event_registration_region_decision")
    .columns(["classification", "reportingRegionId", "decidedAt"])
    .execute();

  await replaceAuditActions(db, nextAuditActions);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await replaceAuditActions(db, previousAuditActions);
  await db.schema.dropTable("event_registration_region_decision").execute();
}
