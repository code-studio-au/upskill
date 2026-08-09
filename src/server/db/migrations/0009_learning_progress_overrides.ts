import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("learning_progress_override")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("enrollmentId", "text", (column) =>
      column.notNull().references("enrollment.id").onDelete("restrict"),
    )
    .addColumn("scope", "text", (column) => column.notNull())
    .addColumn("modulePosition", "integer")
    .addColumn("state", "text", (column) => column.notNull())
    .addColumn("actorUserId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("reason", "text", (column) => column.notNull())
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "learning_progress_override_scope_check",
      sql`(
        scope = 'module'
        and "modulePosition" is not null
        and "modulePosition" >= 0
      ) or (
        scope = 'enrollment'
        and "modulePosition" is null
      )`,
    )
    .addCheckConstraint(
      "learning_progress_override_state_check",
      sql`state in ('completed', 'incomplete')`,
    )
    .addCheckConstraint(
      "learning_progress_override_reason_check",
      sql`reason = btrim(reason) and char_length(reason) between 10 and 500`,
    )
    .execute();

  await sql`
    create index learning_progress_override_latest_idx
      on learning_progress_override
      ("enrollmentId", scope, "modulePosition", "createdAt" desc, id desc)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("learning_progress_override_latest_idx")
    .ifExists()
    .execute();
  await db.schema.dropTable("learning_progress_override").ifExists().execute();
}
