import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("event_survey_access")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventOccurrenceId", "text", (column) =>
      column.notNull().references("event_occurrence.id").onDelete("cascade"),
    )
    .addColumn("eventTemplateVersionItemId", "text", (column) =>
      column
        .notNull()
        .references("event_template_version_item.id")
        .onDelete("restrict"),
    )
    .addColumn("publicReference", "text", (column) => column.notNull())
    .addColumn("generation", "integer", (column) =>
      column.notNull().defaultTo(1),
    )
    .addColumn("accessPolicy", "text", (column) =>
      column.notNull().defaultTo("authenticated_participant"),
    )
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("revokedAt", "timestamptz")
    .addUniqueConstraint("event_survey_access_public_reference_uq", [
      "publicReference",
    ])
    .addUniqueConstraint("event_survey_access_generation_uq", [
      "eventOccurrenceId",
      "eventTemplateVersionItemId",
      "generation",
    ])
    .addCheckConstraint(
      "event_survey_access_reference_ck",
      sql`"publicReference" ~ '^[A-Za-z0-9_-]{32}$'`,
    )
    .addCheckConstraint(
      "event_survey_access_generation_ck",
      sql`generation > 0`,
    )
    .addCheckConstraint(
      "event_survey_access_policy_ck",
      sql`"accessPolicy" = 'authenticated_participant'`,
    )
    .execute();

  await sql`create unique index event_survey_access_active_item_uq
    on event_survey_access ("eventOccurrenceId", "eventTemplateVersionItemId")
    where "revokedAt" is null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("event_survey_access").ifExists().execute();
}
