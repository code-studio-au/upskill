import { sql, type Kysely } from "kysely";

const auditActions = [
  "access_grant.owner_activated",
  "access_grant.owner_assigned",
  "access_grant.owner_code_revealed",
  "access_grant.owner_revoked",
  "access_grant.administrator_capacity_updated",
  "access_grant.administrator_code_revealed",
  "access_grant.administrator_created",
  "access_grant.administrator_revoked",
  "course.archived",
  "course.created",
  "course.deleted",
  "course.published",
  "course.version_created",
  "communication_plan.created",
  "communication_plan.deleted",
  "communication_plan.overridden",
  "communication_plan.reset",
  "communication_plan.updated",
  "email_design.created",
  "email_design.draft_created",
  "email_design.draft_deleted",
  "email_design.published",
  "email_design.reordered",
  "email_design.rolled_back",
  "event_occurrence.created",
  "event_occurrence.guest_access_rotated",
  "event_occurrence.updated",
  "event_occurrence.published",
  "event_occurrence.lifecycle_changed",
  "event_occurrence.rescheduled",
  "event_staff.eligibility_granted",
  "event_staff.eligibility_revoked",
  "coordination_region.created",
  "coordination_region.updated",
  "coordination_region.retired",
  "coordination_region.reactivated",
  "event_attendance.recorded",
  "event_prerequisite.recovery_verified",
  "event_region_review.locked",
  "event_registration.administrator_added",
  "event_registration.coordinator_reviewed",
  "event_registration.final_decided",
  "event_registration.region_mismatch_acknowledged",
  "event_registration.region_decided",
  "event_registration.region_reassigned",
  "event_registration.submitted",
  "event_registration.withdrawn",
  "event_template.created",
  "event_template.draft_deleted",
  "event_template.version_created",
  "event_template.version_published",
  "enrollment.access_code_redeemed",
  "enrollment.administrator_added",
  "enrollment.administrator_removed",
  "enrollment.learning_completed",
  "enrollment.purchased",
  "enrollment.scorm_completed",
  "entitlement.information_release_accepted",
  "learning.progress_overridden",
  "notification.delivery_requeued",
  "order.checkout_failed",
  "order.checkout_paid",
  "order.paid_existing_enrollment",
  "order.refund_recorded",
  "resource.uploaded",
  "resource.version_removed",
  "scorm.attempt_launch_issued",
  "scorm.package_ready",
  "scorm.package_rejected",
  "scorm.package_uploaded",
  "scorm.package_version_removed",
  "survey.created",
  "survey.published",
  "survey.version_created",
  "user.provisional_created",
  "user.account_activated",
  "user.account_setup_resent",
  "user.onboarding_reassigned",
  "user.phone_verification_transferred",
  "user.region_updated",
] as const;

function constraint(values: ReadonlyArray<string>): string {
  return values.map((value) => `'${value}'`).join(", ");
}

async function replaceAuditConstraint(
  db: Kysely<unknown>,
  values: ReadonlyArray<string>,
): Promise<void> {
  await sql`alter table audit_event drop constraint audit_event_action_known_ck`.execute(
    db,
  );
  await sql
    .raw(
      `alter table audit_event add constraint audit_event_action_known_ck check (action in (${constraint(values)}))`,
    )
    .execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table email_design add column position integer`.execute(db);
  await sql`with positioned as (
      select id,
             row_number() over (
               partition by "contextKey"
               order by name, id
             ) - 1 as position
      from email_design
    )
    update email_design
       set position = positioned.position
      from positioned
     where positioned.id = email_design.id`.execute(db);
  await sql`alter table email_design alter column position set not null`.execute(
    db,
  );
  await sql`alter table email_design
    add constraint email_design_position_ck check (position >= 0)`.execute(db);
  await sql`alter table email_design
    add constraint email_design_context_position_uq
    unique ("contextKey", position) deferrable initially deferred`.execute(db);
  await sql`create index email_design_catalogue_position_idx
    on email_design (catalogue, "contextKey", position, id)`.execute(db);
  await replaceAuditConstraint(db, auditActions);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index email_design_catalogue_position_idx`.execute(db);
  await sql`alter table email_design
    drop constraint email_design_context_position_uq,
    drop constraint email_design_position_ck,
    drop column position`.execute(db);
  // Durable audit rows are append-only, so the expanded action constraint must
  // remain valid if email ordering is rolled back.
}
