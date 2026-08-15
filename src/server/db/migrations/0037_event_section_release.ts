import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("event_section_release")
    .addColumn("eventParticipationId", "text", (column) =>
      column
        .notNull()
        .references("event_participation.id")
        .onDelete("restrict"),
    )
    .addColumn("eventTemplateVersionSectionId", "text", (column) =>
      column
        .notNull()
        .references("event_template_version_section.id")
        .onDelete("restrict"),
    )
    .addColumn("releasedAt", "timestamptz", (column) => column.notNull())
    .addPrimaryKeyConstraint("event_section_release_pk", [
      "eventParticipationId",
      "eventTemplateVersionSectionId",
    ])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("event_section_release").ifExists().execute();
}
