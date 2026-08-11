import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("event_template_version_section")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventTemplateVersionId", "text", (column) =>
      column
        .notNull()
        .references("event_template_version.id")
        .onDelete("cascade"),
    )
    .addColumn("position", "integer", (column) => column.notNull())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("description", "text", (column) => column.notNull())
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("event_template_section_position_uq", [
      "eventTemplateVersionId",
      "position",
    ])
    .addUniqueConstraint("event_template_section_identity_uq", [
      "id",
      "eventTemplateVersionId",
    ])
    .addCheckConstraint(
      "event_template_section_position_ck",
      sql`position >= 0`,
    )
    .execute();

  await db.schema
    .createTable("event_template_version_item")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventTemplateVersionId", "text", (column) => column.notNull())
    .addColumn("sectionId", "text", (column) => column.notNull())
    .addColumn("position", "integer", (column) => column.notNull())
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("required", "boolean", (column) =>
      column.notNull().defaultTo(true),
    )
    .addColumn("durationMinutes", "integer")
    .addColumn("learningActivityVersionId", "text")
    .addColumn("sessionDefinitionId", "text")
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addForeignKeyConstraint(
      "event_template_item_activity_fk",
      ["learningActivityVersionId"],
      "learning_activity_version",
      ["id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "event_template_item_section_fk",
      ["sectionId", "eventTemplateVersionId"],
      "event_template_version_section",
      ["id", "eventTemplateVersionId"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "event_template_item_session_fk",
      ["sessionDefinitionId", "eventTemplateVersionId"],
      "event_template_session_definition",
      ["id", "eventTemplateVersionId"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addUniqueConstraint("event_template_item_position_uq", [
      "sectionId",
      "position",
    ])
    .addCheckConstraint("event_template_item_position_ck", sql`position >= 0`)
    .addCheckConstraint(
      "event_template_item_reference_ck",
      sql`(
          kind = 'session'
          and "sessionDefinitionId" is not null
          and "learningActivityVersionId" is null
          and "durationMinutes" is not null
          and "durationMinutes" > 0
        ) or (
          kind in ('scorm', 'survey')
          and "sessionDefinitionId" is null
          and "learningActivityVersionId" is not null
          and ("durationMinutes" is null or "durationMinutes" > 0)
        ) or (
          kind = 'resource'
          and "sessionDefinitionId" is null
          and "learningActivityVersionId" is not null
          and "durationMinutes" is null
        )`,
    )
    .execute();

  await sql`alter table event_occurrence
    drop constraint event_occurrence_delivery_mode_ck,
    drop constraint event_occurrence_location_ck`.execute(db);
  await sql`alter table event_occurrence
    add constraint event_occurrence_delivery_mode_ck
      check ("deliveryMode" in ('in_person', 'virtual')),
    add constraint event_occurrence_location_ck
      check (("deliveryMode" = 'in_person' and "venueName" is not null and "virtualJoinUrl" is null)
        or ("deliveryMode" = 'virtual' and "virtualJoinUrl" is not null and "venueName" is null and "venueAddress" is null))`.execute(
    db,
  );

  await sql`alter table audit_event
    drop constraint audit_event_action_known_ck`.execute(db);
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
      'event_occurrence.created', 'event_occurrence.published', 'event_template.created',
      'event_template.version_created', 'event_template.version_published'
    ))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("event_template_version_item").ifExists().execute();
  await db.schema
    .dropTable("event_template_version_section")
    .ifExists()
    .execute();
  await sql`alter table event_occurrence
    drop constraint event_occurrence_delivery_mode_ck,
    drop constraint event_occurrence_location_ck`.execute(db);
  await sql`alter table event_occurrence
    add constraint event_occurrence_delivery_mode_ck
      check ("deliveryMode" in ('in_person', 'virtual', 'hybrid')),
    add constraint event_occurrence_location_ck
      check (("deliveryMode" <> 'in_person' or "venueName" is not null)
        and ("deliveryMode" <> 'virtual' or "virtualJoinUrl" is not null)
        and ("deliveryMode" <> 'hybrid' or ("venueName" is not null and "virtualJoinUrl" is not null)))`.execute(
    db,
  );
  await sql`alter table audit_event
    drop constraint audit_event_action_known_ck`.execute(db);
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
      'event_occurrence.created', 'event_occurrence.published', 'event_template.created',
      'event_template.version_published'
    ))`.execute(db);
}
