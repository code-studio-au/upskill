import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createIndex("course_status_idx")
    .on("course")
    .column("status")
    .execute();
  await sql`
    create index course_version_published_lookup_idx
      on course_version ("courseId", version desc)
      where "publishedAt" is not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("course_version_published_lookup_idx")
    .ifExists()
    .execute();
  await db.schema.dropIndex("course_status_idx").ifExists().execute();
}
