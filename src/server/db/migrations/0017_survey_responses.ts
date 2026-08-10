import { sql, type Kysely } from "kysely";

const actions = [
  "course.archived",
  "course.created",
  "course.deleted",
  "course.published",
  "course.version_created",
  "enrollment.access_code_redeemed",
  "enrollment.learning_completed",
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
  "survey.created",
  "survey.published",
  "survey.version_created",
] as const;

function constraint(values: ReadonlyArray<string>): string {
  return values.map((value) => `'${value}'`).join(", ");
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("survey_response")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("enrollmentId", "text", (column) =>
      column.notNull().references("enrollment.id").onDelete("restrict"),
    )
    .addColumn("courseVersionItemId", "text", (column) =>
      column
        .notNull()
        .references("course_version_item.id")
        .onDelete("restrict"),
    )
    .addColumn("surveyVersionId", "text", (column) =>
      column.notNull().references("survey_version.id").onDelete("restrict"),
    )
    .addColumn("answers", "jsonb", (column) => column.notNull())
    .addColumn("submittedAt", "timestamptz", (column) => column.notNull())
    .addUniqueConstraint("survey_response_enrollment_item_uq", [
      "enrollmentId",
      "courseVersionItemId",
    ])
    .addCheckConstraint(
      "survey_response_answers_object_ck",
      sql`jsonb_typeof(answers) = 'object'`,
    )
    .execute();

  await db.schema
    .createIndex("survey_response_enrollment_idx")
    .on("survey_response")
    .columns(["enrollmentId", "submittedAt"])
    .execute();

  await sql`alter table audit_event
    drop constraint audit_event_action_known_ck`.execute(db);
  await sql
    .raw(
      `alter table audit_event add constraint audit_event_action_known_ck
       check (action in (${constraint(actions)}))`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table audit_event
    drop constraint audit_event_action_known_ck`.execute(db);
  await sql
    .raw(
      `alter table audit_event add constraint audit_event_action_known_ck
       check (action in (${constraint(
         actions.filter((action) => !action.startsWith("survey.")),
       )}))`,
    )
    .execute(db);
  await db.schema
    .dropIndex("survey_response_enrollment_idx")
    .ifExists()
    .execute();
  await db.schema.dropTable("survey_response").ifExists().execute();
}
