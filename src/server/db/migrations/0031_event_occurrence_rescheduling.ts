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
  'event_occurrence.lifecycle_changed', 'event_occurrence.rescheduled', 'event_attendance.recorded',
  'event_registration.submitted', 'event_registration.administrator_added',
  'event_registration.coordinator_reviewed', 'event_registration.final_decided',
  'event_registration.withdrawn', 'event_region_review.locked',
  'event_template.created', 'event_template.version_created', 'event_template.version_published'
`);

const previous = sql.raw(`
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
  'event_occurrence.lifecycle_changed', 'event_attendance.recorded', 'event_registration.submitted',
  'event_registration.administrator_added', 'event_registration.coordinator_reviewed',
  'event_registration.final_decided', 'event_registration.withdrawn', 'event_region_review.locked',
  'event_template.created', 'event_template.version_created', 'event_template.version_published'
`);

async function replaceAuditActions(
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

export async function up(db: Kysely<unknown>) {
  await db.schema
    .createTable("event_occurrence_reschedule")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventOccurrenceId", "text", (column) =>
      column.notNull().references("event_occurrence.id").onDelete("restrict"),
    )
    .addColumn("registrationWindowPolicy", "text", (column) => column.notNull())
    .addColumn("previousTimezone", "text", (column) => column.notNull())
    .addColumn("previousLocalStartsAt", "text", (column) => column.notNull())
    .addColumn("previousLocalEndsAt", "text", (column) => column.notNull())
    .addColumn("previousLocalRegistrationOpensAt", "text")
    .addColumn("previousLocalRegistrationClosesAt", "text")
    .addColumn("previousLocalCoordinatorLockAt", "text")
    .addColumn("previousStartsAt", "timestamptz", (column) => column.notNull())
    .addColumn("previousEndsAt", "timestamptz", (column) => column.notNull())
    .addColumn("previousRegistrationOpensAt", "timestamptz")
    .addColumn("previousRegistrationClosesAt", "timestamptz")
    .addColumn("previousCoordinatorLockAt", "timestamptz")
    .addColumn("nextTimezone", "text", (column) => column.notNull())
    .addColumn("nextLocalStartsAt", "text", (column) => column.notNull())
    .addColumn("nextLocalEndsAt", "text", (column) => column.notNull())
    .addColumn("nextLocalRegistrationOpensAt", "text")
    .addColumn("nextLocalRegistrationClosesAt", "text")
    .addColumn("nextLocalCoordinatorLockAt", "text")
    .addColumn("nextStartsAt", "timestamptz", (column) => column.notNull())
    .addColumn("nextEndsAt", "timestamptz", (column) => column.notNull())
    .addColumn("nextRegistrationOpensAt", "timestamptz")
    .addColumn("nextRegistrationClosesAt", "timestamptz")
    .addColumn("nextCoordinatorLockAt", "timestamptz")
    .addColumn("actorUserId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "event_occurrence_reschedule_policy_ck",
      sql`"registrationWindowPolicy" in ('keep', 'replace_future', 'reopen')`,
    )
    .addCheckConstraint(
      "event_occurrence_reschedule_schedule_ck",
      sql`"nextEndsAt" > "nextStartsAt"`,
    )
    .addCheckConstraint(
      "event_reschedule_local_schedule_ck",
      sql`"previousLocalStartsAt" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$'
        and "previousLocalEndsAt" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$'
        and "nextLocalStartsAt" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$'
        and "nextLocalEndsAt" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$'
        and ("previousLocalRegistrationOpensAt" is null or "previousLocalRegistrationOpensAt" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$')
        and ("previousLocalRegistrationClosesAt" is null or "previousLocalRegistrationClosesAt" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$')
        and ("previousLocalCoordinatorLockAt" is null or "previousLocalCoordinatorLockAt" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$')
        and ("nextLocalRegistrationOpensAt" is null or "nextLocalRegistrationOpensAt" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$')
        and ("nextLocalRegistrationClosesAt" is null or "nextLocalRegistrationClosesAt" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$')
        and ("nextLocalCoordinatorLockAt" is null or "nextLocalCoordinatorLockAt" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$')`,
    )
    .execute();

  await db.schema
    .createIndex("event_occurrence_reschedule_history_idx")
    .on("event_occurrence_reschedule")
    .columns(["eventOccurrenceId", "createdAt"])
    .execute();

  await db.schema
    .createTable("event_occurrence_reschedule_region")
    .addColumn("eventOccurrenceRescheduleId", "text", (column) =>
      column
        .notNull()
        .references("event_occurrence_reschedule.id")
        .onDelete("restrict"),
    )
    .addColumn("eventOccurrenceRegionId", "text", (column) =>
      column
        .notNull()
        .references("event_occurrence_region.id")
        .onDelete("restrict"),
    )
    .addPrimaryKeyConstraint("event_occurrence_reschedule_region_pk", [
      "eventOccurrenceRescheduleId",
      "eventOccurrenceRegionId",
    ])
    .execute();

  await db.schema
    .createTable("event_occurrence_reschedule_region_coordinator")
    .addColumn("eventOccurrenceRescheduleId", "text", (column) =>
      column
        .notNull()
        .references("event_occurrence_reschedule.id")
        .onDelete("restrict"),
    )
    .addColumn("eventOccurrenceRegionId", "text", (column) => column.notNull())
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "event_reschedule_region_coordinator_region_fk",
      ["eventOccurrenceRescheduleId", "eventOccurrenceRegionId"],
      "event_occurrence_reschedule_region",
      ["eventOccurrenceRescheduleId", "eventOccurrenceRegionId"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addPrimaryKeyConstraint("event_reschedule_region_coordinator_pk", [
      "eventOccurrenceRescheduleId",
      "eventOccurrenceRegionId",
      "userId",
    ])
    .execute();

  await db.schema
    .alterTable("event_region_review_round")
    .addColumn("eventOccurrenceRescheduleId", "text", (column) =>
      column.references("event_occurrence_reschedule.id").onDelete("restrict"),
    )
    .execute();

  await replaceAuditActions(db, actions);
}

export async function down(db: Kysely<unknown>) {
  await replaceAuditActions(db, previous);
  await db.schema
    .alterTable("event_region_review_round")
    .dropColumn("eventOccurrenceRescheduleId")
    .execute();
  await db.schema
    .dropTable("event_occurrence_reschedule_region_coordinator")
    .execute();
  await db.schema.dropTable("event_occurrence_reschedule_region").execute();
  await db.schema.dropTable("event_occurrence_reschedule").execute();
}
