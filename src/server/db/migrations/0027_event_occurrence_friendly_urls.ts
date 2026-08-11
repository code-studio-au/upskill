import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("event_occurrence")
    .addColumn("slug", "text")
    .execute();

  await sql`update event_occurrence
    set slug = left(
      coalesce(
        nullif(trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')), ''),
        'event'
      ),
      90
    ) || '-' || right(regexp_replace(id, '[^a-zA-Z0-9]', '', 'g'), 8)`.execute(
    db,
  );

  await db.schema
    .alterTable("event_occurrence")
    .alterColumn("slug", (column) => column.setNotNull())
    .execute();
  await db.schema
    .alterTable("event_occurrence")
    .addUniqueConstraint("event_occurrence_slug_uq", ["slug"])
    .execute();

  await db.schema.alterTable("event_template").dropColumn("slug").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("event_template")
    .addColumn("slug", "text")
    .execute();

  await sql`update event_template
    set slug = left(
      coalesce(
        nullif(trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')), ''),
        'event'
      ),
      90
    ) || '-' || right(regexp_replace(id, '[^a-zA-Z0-9]', '', 'g'), 8)`.execute(
    db,
  );

  await db.schema
    .alterTable("event_template")
    .alterColumn("slug", (column) => column.setNotNull())
    .execute();
  await db.schema
    .alterTable("event_template")
    .addUniqueConstraint("event_template_slug_uq", ["slug"])
    .execute();

  await db.schema.alterTable("event_occurrence").dropColumn("slug").execute();
}
