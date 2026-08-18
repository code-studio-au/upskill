import { sql, type Kysely } from "kysely";

const addedAuditActions = [
  "access_grant.owner_assigned",
  "access_grant.owner_activated",
  "access_grant.owner_revoked",
  "access_grant.owner_code_revealed",
  "entitlement.information_release_accepted",
] as const;

async function addAuditActions(db: Kysely<unknown>): Promise<void> {
  await sql`alter table audit_event drop constraint audit_event_action_known_ck`.execute(
    db,
  );
  await sql`alter table audit_event add constraint audit_event_action_known_ck
    check (action in (
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
      'user.onboarding_reassigned', 'user.region_updated',
      ${sql.join(addedAuditActions.map((action) => sql.lit(action)))}
    ))`.execute(db);
}

async function removeAuditActions(db: Kysely<unknown>): Promise<void> {
  await sql`alter table audit_event drop constraint audit_event_action_known_ck`.execute(
    db,
  );
  await sql`alter table audit_event add constraint audit_event_action_known_ck
    check (action not in (${sql.join(addedAuditActions.map((action) => sql.lit(action)))})
      and action in (
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
      ))`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("access_grant")
    .addColumn("kind", "text", (column) =>
      column.notNull().defaultTo("bulk_purchase"),
    )
    .addColumn("customerExtendable", "boolean", (column) =>
      column.notNull().defaultTo(false),
    )
    .execute();
  await sql`update access_grant
    set kind = 'individual_purchase'
    where "orderId" is not null`.execute(db);
  await db.schema
    .alterTable("access_grant")
    .addCheckConstraint(
      "access_grant_kind_ck",
      sql`kind in ('bulk_purchase', 'enterprise_contract', 'individual_purchase')`,
    )
    .execute();

  await db.schema
    .createTable("access_grant_owner_assignment")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("accessGrantId", "text", (column) =>
      column.notNull().references("access_grant.id").onDelete("restrict"),
    )
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("invitedEmail", "text", (column) => column.notNull())
    .addColumn("invitedByUserId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("invitedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("activatedAt", "timestamptz")
    .addColumn("revokedAt", "timestamptz")
    .addColumn("revokedByUserId", "text", (column) =>
      column.references("user.id").onDelete("restrict"),
    )
    .addCheckConstraint(
      "access_grant_owner_email_normalized_ck",
      sql`"invitedEmail" = lower(btrim("invitedEmail")) and position('@' in "invitedEmail") > 1`,
    )
    .addCheckConstraint(
      "access_grant_owner_revocation_ck",
      sql`("revokedAt" is null) = ("revokedByUserId" is null)`,
    )
    .execute();
  await sql`create unique index access_grant_owner_current_uq
    on access_grant_owner_assignment ("accessGrantId", lower("invitedEmail"))
    where "revokedAt" is null`.execute(db);
  await db.schema
    .createIndex("access_grant_owner_user_idx")
    .on("access_grant_owner_assignment")
    .columns(["userId", "revokedAt", "accessGrantId"])
    .execute();

  await db.schema
    .createTable("entitlement")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("courseVersionId", "text", (column) =>
      column.notNull().references("course_version.id").onDelete("restrict"),
    )
    .addColumn("enrollmentId", "text", (column) =>
      column
        .notNull()
        .unique()
        .references("enrollment.id")
        .onDelete("restrict"),
    )
    .addColumn("originType", "text", (column) => column.notNull())
    .addColumn("originAccessGrantId", "text", (column) =>
      column.references("access_grant.id").onDelete("restrict"),
    )
    .addColumn("originOrderId", "text", (column) =>
      column.references("order.id").onDelete("restrict"),
    )
    .addColumn("redemptionEmailSnapshot", "text", (column) => column.notNull())
    .addColumn("informationReleaseNoticeVersion", "text")
    .addColumn("informationReleaseAcceptedAt", "timestamptz")
    .addColumn("grantedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("revokedAt", "timestamptz")
    .addCheckConstraint(
      "entitlement_origin_ck",
      sql`(
        "originType" = 'access_grant' and "originAccessGrantId" is not null and "originOrderId" is null
      ) or (
        "originType" = 'order' and "originAccessGrantId" is null and "originOrderId" is not null
      ) or (
        "originType" = 'administrator' and "originAccessGrantId" is null and "originOrderId" is null
      )`,
    )
    .addCheckConstraint(
      "entitlement_information_release_ck",
      sql`("informationReleaseNoticeVersion" is null) = ("informationReleaseAcceptedAt" is null)`,
    )
    .execute();
  await db.schema
    .createIndex("entitlement_access_grant_idx")
    .on("entitlement")
    .columns(["originAccessGrantId", "grantedAt"])
    .execute();

  await sql`insert into entitlement (
      id, "userId", "courseVersionId", "enrollmentId", "originType",
      "originAccessGrantId", "originOrderId", "redemptionEmailSnapshot", "grantedAt"
    )
    select
      'entitlement_backfill_' || enrollment.id,
      enrollment."userId",
      enrollment."courseVersionId",
      enrollment.id,
      case
        when access_grant."orderId" is not null then 'order'
        when access_grant.id is not null then 'access_grant'
        else 'administrator'
      end,
      case when access_grant.id is not null and access_grant."orderId" is null then access_grant.id end,
      access_grant."orderId",
      lower("user".email),
      enrollment."enrolledAt"
    from enrollment
    join "user" on "user".id = enrollment."userId"
    left join access_grant on access_grant.id = enrollment."accessGrantId"`.execute(
    db,
  );

  await addAuditActions(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await removeAuditActions(db);
  await db.schema.dropTable("entitlement").execute();
  await db.schema.dropTable("access_grant_owner_assignment").execute();
  await db.schema
    .alterTable("access_grant")
    .dropConstraint("access_grant_kind_ck")
    .execute();
  await db.schema
    .alterTable("access_grant")
    .dropColumn("customerExtendable")
    .dropColumn("kind")
    .execute();
}
