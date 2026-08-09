import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("learning_progress_override")
    .dropConstraint("learning_progress_override_reason_check")
    .execute();
  await sql`
    alter table learning_progress_override
      alter column reason drop not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    update learning_progress_override
    set reason = 'Administrator progress correction.'
    where reason is null
  `.execute(db);
  await sql`
    alter table learning_progress_override
      alter column reason set not null
  `.execute(db);
  await db.schema
    .alterTable("learning_progress_override")
    .addCheckConstraint(
      "learning_progress_override_reason_check",
      sql`reason = btrim(reason) and char_length(reason) between 10 and 500`,
    )
    .execute();
}
