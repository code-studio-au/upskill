import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_join_access
    add column "lobbyRevision" integer not null default 0,
    add constraint event_virtual_join_access_lobby_revision_ck
      check ("lobbyRevision" >= 0)`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_join_access
    drop constraint event_virtual_join_access_lobby_revision_ck,
    drop column "lobbyRevision"`.execute(db);
}
