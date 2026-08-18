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
  'event_registration.region_mismatch_acknowledged', 'event_registration.region_decided',
  'event_region_review.locked',
  'event_template.created', 'event_template.draft_deleted', 'event_template.version_created',
  'event_template.version_published', 'event_staff.eligibility_granted', 'event_staff.eligibility_revoked',
  'coordination_region.created', 'coordination_region.updated',
  'coordination_region.retired', 'coordination_region.reactivated',
  'user.provisional_created', 'user.account_activated', 'user.account_setup_resent',
  'user.onboarding_reassigned', 'user.region_updated',
  'access_grant.owner_assigned', 'access_grant.owner_activated',
  'access_grant.owner_revoked', 'access_grant.owner_code_revealed',
  'entitlement.information_release_accepted'
`);

const nextAuditActions = sql.raw(`
  'course.archived', 'course.created', 'course.deleted', 'course.published', 'course.version_created',
  'enrollment.access_code_redeemed', 'enrollment.administrator_added', 'enrollment.administrator_removed',
  'enrollment.learning_completed', 'enrollment.purchased', 'enrollment.scorm_completed',
  'learning.progress_overridden', 'order.checkout_failed', 'order.checkout_paid', 'order.paid_existing_enrollment',
  'order.refund_recorded',
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
  'access_grant.owner_assigned', 'access_grant.owner_activated',
  'access_grant.owner_revoked', 'access_grant.owner_code_revealed',
  'entitlement.information_release_accepted'
`);

async function replaceAuditActions(
  db: Kysely<unknown>,
  actions: ReturnType<typeof sql.raw>,
): Promise<void> {
  await sql`alter table audit_event drop constraint audit_event_action_known_ck`.execute(
    db,
  );
  await sql`alter table audit_event add constraint audit_event_action_known_ck check (action in (${actions}))`.execute(
    db,
  );
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("order")
    .addColumn("kind", "text", (column) =>
      column.notNull().defaultTo("individual_purchase"),
    )
    .addColumn("stripeInvoiceId", "text")
    .addColumn("refundedCents", "integer", (column) =>
      column.notNull().defaultTo(0),
    )
    .execute();
  await db.schema
    .alterTable("order")
    .dropConstraint("order_status_check")
    .execute();
  await db.schema
    .alterTable("order")
    .addCheckConstraint(
      "order_status_check",
      sql`status in ('pending', 'paid', 'failed', 'partially_refunded', 'refunded')`,
    )
    .execute();
  await db.schema
    .alterTable("order")
    .addCheckConstraint(
      "order_kind_ck",
      sql`kind in ('individual_purchase', 'bulk_purchase', 'capacity_extension')`,
    )
    .execute();
  await db.schema
    .alterTable("order")
    .addCheckConstraint(
      "order_refunded_amount_ck",
      sql`"refundedCents" >= 0 and "refundedCents" <= "totalCents"`,
    )
    .execute();
  await sql`create unique index order_stripe_payment_intent_uq
    on "order" ("stripePaymentIntentId")
    where "stripePaymentIntentId" is not null`.execute(db);

  await db.schema
    .createTable("bulk_order")
    .addColumn("orderId", "text", (column) =>
      column.primaryKey().references("order.id").onDelete("cascade"),
    )
    .addColumn("accessGrantId", "text", (column) =>
      column.references("access_grant.id").onDelete("restrict"),
    )
    .addColumn("organizationName", "text", (column) => column.notNull())
    .addColumn("grantLabel", "text", (column) => column.notNull())
    .addColumn("fulfillmentMode", "text", (column) => column.notNull())
    .addColumn("codePrefix", "text", (column) => column.notNull())
    .addColumn("customerExtendable", "boolean", (column) =>
      column.notNull().defaultTo(true),
    )
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "bulk_order_fulfillment_mode_ck",
      sql`"fulfillmentMode" in ('shared_code', 'single_use_codes')`,
    )
    .addCheckConstraint(
      "bulk_order_organization_name_ck",
      sql`char_length(btrim("organizationName")) between 2 and 120`,
    )
    .addCheckConstraint(
      "bulk_order_grant_label_ck",
      sql`char_length(btrim("grantLabel")) between 2 and 120`,
    )
    .execute();
  await db.schema
    .createIndex("bulk_order_access_grant_idx")
    .on("bulk_order")
    .columns(["accessGrantId", "createdAt"])
    .execute();

  await db.schema
    .createTable("order_refund")
    .addColumn("stripeRefundId", "text", (column) => column.primaryKey())
    .addColumn("orderId", "text", (column) =>
      column.notNull().references("order.id").onDelete("restrict"),
    )
    .addColumn("amountCents", "integer", (column) => column.notNull())
    .addColumn("currency", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("reason", "text")
    .addColumn("createdAt", "timestamptz", (column) => column.notNull())
    .addColumn("updatedAt", "timestamptz", (column) => column.notNull())
    .addCheckConstraint("order_refund_amount_ck", sql`"amountCents" > 0`)
    .addCheckConstraint(
      "order_refund_status_ck",
      sql`status in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')`,
    )
    .execute();
  await db.schema
    .createIndex("order_refund_order_idx")
    .on("order_refund")
    .columns(["orderId", "createdAt"])
    .execute();

  await replaceAuditActions(db, nextAuditActions);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await replaceAuditActions(db, previousAuditActions);
  await db.schema.dropTable("order_refund").execute();
  await db.schema.dropTable("bulk_order").execute();
  await db.schema.dropIndex("order_stripe_payment_intent_uq").execute();
  await db.schema
    .alterTable("order")
    .dropConstraint("order_refunded_amount_ck")
    .execute();
  await db.schema.alterTable("order").dropConstraint("order_kind_ck").execute();
  await db.schema
    .alterTable("order")
    .dropConstraint("order_status_check")
    .execute();
  await db.schema
    .alterTable("order")
    .addCheckConstraint(
      "order_status_check",
      sql`status in ('pending', 'paid', 'failed', 'refunded')`,
    )
    .execute();
  for (const column of ["refundedCents", "stripeInvoiceId", "kind"])
    await db.schema.alterTable("order").dropColumn(column).execute();
}
