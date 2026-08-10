import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("survey_progress")
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
    .addColumn("answers", "jsonb", (column) =>
      column.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn("visitedItemIds", "jsonb", (column) =>
      column.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn("currentItemId", "text")
    .addColumn("startedAt", "timestamptz", (column) => column.notNull())
    .addColumn("updatedAt", "timestamptz", (column) => column.notNull())
    .addColumn("completedAt", "timestamptz")
    .addPrimaryKeyConstraint("survey_progress_pk", [
      "enrollmentId",
      "courseVersionItemId",
    ])
    .addCheckConstraint(
      "survey_progress_answers_object_ck",
      sql`jsonb_typeof(answers) = 'object'`,
    )
    .addCheckConstraint(
      "survey_progress_visited_array_ck",
      sql`jsonb_typeof("visitedItemIds") = 'array'`,
    )
    .execute();

  await db.schema
    .createIndex("survey_progress_enrollment_idx")
    .on("survey_progress")
    .columns(["enrollmentId", "updatedAt"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("survey_progress_enrollment_idx")
    .ifExists()
    .execute();
  await db.schema.dropTable("survey_progress").ifExists().execute();
}
