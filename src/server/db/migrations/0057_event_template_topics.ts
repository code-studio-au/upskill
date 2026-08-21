import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table event_template_version
    add column topic text not null default 'General',
    add constraint event_template_version_topic_ck
      check (length(btrim(topic)) between 2 and 80
        and lower(btrim(topic)) <> 'all')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table event_template_version
    drop constraint event_template_version_topic_ck,
    drop column topic`.execute(db);
}
