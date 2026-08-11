import { sql, type Kysely } from "kysely";

const knownAuditActions = [
  "course.archived",
  "course.created",
  "course.deleted",
  "course.published",
  "course.version_created",
  "enrollment.access_code_redeemed",
  "enrollment.purchased",
  "enrollment.scorm_completed",
  "learning.progress_overridden",
  "order.checkout_failed",
  "order.checkout_paid",
  "order.paid_existing_enrollment",
  "resource.uploaded",
  "scorm.attempt_launch_issued",
  "scorm.package_ready",
  "scorm.package_rejected",
  "scorm.package_uploaded",
  "scorm.package_version_removed",
] as const;

function auditActionConstraint(actions: ReadonlyArray<string>): string {
  return actions.map((action) => `'${action}'`).join(", ");
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("survey_version")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("kind", "text", (column) => column.notNull().defaultTo("survey"))
    .addColumn("content", "jsonb", (column) => column.notNull())
    .addForeignKeyConstraint(
      "survey_version_activity_fk",
      ["id", "kind"],
      "learning_activity_version",
      ["id", "kind"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addCheckConstraint("survey_version_kind_ck", sql`kind = 'survey'`)
    .execute();

  await db.schema
    .createTable("learning_resource_version")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("kind", "text", (column) =>
      column.notNull().defaultTo("resource"),
    )
    .addColumn("displayName", "text", (column) => column.notNull())
    .addColumn("description", "text", (column) => column.notNull())
    .addColumn("objectKey", "text", (column) => column.notNull().unique())
    .addColumn("sha256", "text", (column) => column.notNull())
    .addColumn("sourceBytes", "integer", (column) => column.notNull())
    .addColumn("mediaType", "text", (column) => column.notNull())
    .addForeignKeyConstraint(
      "learning_resource_version_activity_fk",
      ["id", "kind"],
      "learning_activity_version",
      ["id", "kind"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addCheckConstraint(
      "learning_resource_version_values_ck",
      sql`kind = 'resource'
        and "sourceBytes" > 0
        and "mediaType" = 'application/pdf'
        and sha256 ~ '^[a-f0-9]{64}$'
        and "objectKey" ~ '^resources/[A-Za-z0-9_-]+/[a-f0-9]{64}\\.pdf$'`,
    )
    .execute();

  await db.schema
    .createTable("course_version_section")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("courseVersionId", "text", (column) =>
      column.notNull().references("course_version.id").onDelete("restrict"),
    )
    .addColumn("position", "integer", (column) => column.notNull())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("description", "text", (column) => column.notNull())
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("course_version_section_position_uq", [
      "courseVersionId",
      "position",
    ])
    .addUniqueConstraint("course_version_section_identity_uq", [
      "id",
      "courseVersionId",
    ])
    .addCheckConstraint(
      "course_version_section_position_ck",
      sql`position >= 0`,
    )
    .execute();

  await db.schema
    .createTable("course_version_item")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("courseVersionId", "text", (column) => column.notNull())
    .addColumn("sectionId", "text", (column) => column.notNull())
    .addColumn("position", "integer", (column) => column.notNull())
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("required", "boolean", (column) =>
      column.notNull().defaultTo(true),
    )
    .addColumn("durationMinutes", "integer")
    .addColumn("modulePosition", "integer")
    .addColumn("learningActivityVersionId", "text", (column) =>
      column.notNull(),
    )
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addForeignKeyConstraint(
      "course_version_item_section_fk",
      ["sectionId", "courseVersionId"],
      "course_version_section",
      ["id", "courseVersionId"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "course_version_item_activity_version_fk",
      ["learningActivityVersionId", "kind"],
      "learning_activity_version",
      ["id", "kind"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addUniqueConstraint("course_version_item_position_uq", [
      "sectionId",
      "position",
    ])
    .addCheckConstraint("course_version_item_position_ck", sql`position >= 0`)
    .addCheckConstraint(
      "course_version_item_reference_ck",
      sql`(
          kind = 'scorm'
          and "modulePosition" is not null
          and "modulePosition" >= 0
          and "durationMinutes" is not null
          and "durationMinutes" > 0
        ) or (
          kind = 'survey'
          and "modulePosition" is null
          and ("durationMinutes" is null or "durationMinutes" > 0)
        ) or (
          kind = 'resource'
          and "modulePosition" is null
          and "durationMinutes" is null
        )`,
    )
    .execute();

  await db.schema
    .createIndex("course_version_item_module_position_uq")
    .unique()
    .on("course_version_item")
    .columns(["courseVersionId", "modulePosition"])
    .where("modulePosition", "is not", null)
    .execute();

  await db.schema
    .createTable("learning_item_progress")
    .addColumn("enrollmentId", "text", (column) =>
      column.notNull().references("enrollment.id").onDelete("restrict"),
    )
    .addColumn("courseVersionItemId", "text", (column) =>
      column
        .notNull()
        .references("course_version_item.id")
        .onDelete("restrict"),
    )
    .addColumn("state", "text", (column) => column.notNull())
    .addColumn("completedAt", "timestamptz", (column) => column.notNull())
    .addColumn("updatedAt", "timestamptz", (column) => column.notNull())
    .addPrimaryKeyConstraint("learning_item_progress_pk", [
      "enrollmentId",
      "courseVersionItemId",
    ])
    .addCheckConstraint(
      "learning_item_progress_state_ck",
      sql`state = 'completed'`,
    )
    .execute();

  await db.schema
    .createIndex("learning_item_progress_enrollment_idx")
    .on("learning_item_progress")
    .columns(["enrollmentId", "completedAt"])
    .execute();

  await sql`alter table audit_event
    drop constraint audit_event_action_known_ck`.execute(db);
  await sql
    .raw(
      `alter table audit_event add constraint audit_event_action_known_ck
       check (action in (${auditActionConstraint(knownAuditActions)}))`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("learning_item_progress_enrollment_idx")
    .ifExists()
    .execute();
  await db.schema.dropTable("learning_item_progress").ifExists().execute();
  await db.schema
    .dropIndex("course_version_item_module_position_uq")
    .ifExists()
    .execute();
  for (const table of [
    "course_version_item",
    "course_version_section",
    "learning_resource_version",
    "survey_version",
  ])
    await db.schema.dropTable(table).ifExists().execute();

  await sql`alter table audit_event
    drop constraint audit_event_action_known_ck`.execute(db);
  await sql
    .raw(
      `alter table audit_event add constraint audit_event_action_known_ck
       check (action in (${auditActionConstraint(
         knownAuditActions.filter(
           (action) =>
             !action.startsWith("course.") && action !== "resource.uploaded",
         ),
       )}))`,
    )
    .execute(db);
}
