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
  "authorization.platform_admin.bootstrapped",
  "authorization.platform_admin.granted",
  "authorization.platform_admin.invitation_cancelled",
  "authorization.platform_admin.invited",
  "authorization.platform_admin.revoked",
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
  "user.phone_verification_transferred",
  "user.provisional_created",
  "user.account_activated",
  "user.account_setup_resent",
  "user.onboarding_reassigned",
  "user.region_updated",
] as const;

function values(items: ReadonlyArray<string>): string {
  return items.map((item) => `'${item}'`).join(", ");
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table "user" drop constraint user_provisioning_source_ck`.execute(
    db,
  );
  await sql`alter table "user" add constraint user_provisioning_source_ck
    check ("provisioningSource" is null or "provisioningSource" in
      ('administrator', 'open_entry', 'late_invitation', 'access_owner', 'self_purchase'))`.execute(
    db,
  );

  await db.schema
    .createTable("platform_admin_invitation")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("invitedByUserId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("invitedAt", "timestamptz", (column) => column.notNull())
    .addColumn("acceptedAt", "timestamptz")
    .addColumn("cancelledAt", "timestamptz")
    .addColumn("cancelledByUserId", "text", (column) =>
      column.references("user.id").onDelete("set null"),
    )
    .addCheckConstraint(
      "platform_admin_invitation_state_ck",
      sql`not ("acceptedAt" is not null and "cancelledAt" is not null)
        and (("cancelledAt" is null and "cancelledByUserId" is null)
          or ("cancelledAt" is not null and "cancelledByUserId" is not null))`,
    )
    .execute();
  await sql`create unique index platform_admin_invitation_pending_uq
    on platform_admin_invitation ("userId")
    where "acceptedAt" is null and "cancelledAt" is null`.execute(db);

  await sql`alter table audit_event drop constraint audit_event_action_known_ck`.execute(
    db,
  );
  await sql
    .raw(
      `alter table audit_event add constraint audit_event_action_known_ck check (action in (${values(auditActions)}))`,
    )
    .execute(db);
}

export async function down(): Promise<void> {
  // Account and authority records are append-only. A rollback must retain the
  // expanded source/action constraints and invitation evidence.
}
