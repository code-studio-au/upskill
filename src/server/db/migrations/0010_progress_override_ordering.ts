import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("learning_progress_override_latest_idx")
    .ifExists()
    .execute();
  await sql`
    alter table learning_progress_override
      add column sequence bigserial not null,
      add constraint learning_progress_override_sequence_uq unique (sequence)
  `.execute(db);
  await sql`
    create index learning_progress_override_latest_idx
      on learning_progress_override
      ("enrollmentId", scope, "modulePosition", sequence desc)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("learning_progress_override_latest_idx")
    .ifExists()
    .execute();
  await sql`
    alter table learning_progress_override
      drop constraint if exists learning_progress_override_sequence_uq,
      drop column if exists sequence
  `.execute(db);
  await sql`
    create index learning_progress_override_latest_idx
      on learning_progress_override
      ("enrollmentId", scope, "modulePosition", "createdAt" desc, id desc)
  `.execute(db);
}
