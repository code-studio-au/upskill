import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_lobby_entry
    add constraint event_virtual_lobby_entry_revision_scope_uq unique (
      id, "eventVirtualJoinAccessId"
    )`.execute(db);
  await sql`create table event_virtual_lobby_revision (
    revision bigint generated always as identity primary key,
    "eventVirtualJoinAccessId" text not null,
    "lobbyEntryId" text not null,
    constraint event_virtual_lobby_revision_entry_fk foreign key (
      "lobbyEntryId", "eventVirtualJoinAccessId"
    ) references event_virtual_lobby_entry (
      id, "eventVirtualJoinAccessId"
    ) on delete restrict
  )`.execute(db);
  await sql`create index event_virtual_lobby_revision_access_idx
    on event_virtual_lobby_revision (
      "eventVirtualJoinAccessId", revision desc
    )`.execute(db);
  await sql`create function guard_event_virtual_lobby_revision()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'DELETE' then
        if current_user in ('upskill_web', 'upskill_worker') then
          raise exception 'Lobby revision evidence cannot be deleted'
            using errcode = '42501';
        end if;
        return old;
      end if;
      raise exception 'Lobby revision evidence is immutable'
        using errcode = '23514';
    end
    $$`.execute(db);
  await sql`create trigger event_virtual_lobby_revision_guard_trg
    before update or delete on event_virtual_lobby_revision
    for each row execute function guard_event_virtual_lobby_revision()`.execute(
    db,
  );
  await sql`do $$
    begin
      if exists (select 1 from pg_roles where rolname = 'upskill_web') then
        execute 'revoke update, delete on table event_virtual_lobby_revision from upskill_web';
      end if;
      if exists (select 1 from pg_roles where rolname = 'upskill_worker') then
        execute 'revoke update, delete on table event_virtual_lobby_revision from upskill_worker';
      end if;
    end
    $$`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop trigger event_virtual_lobby_revision_guard_trg
    on event_virtual_lobby_revision`.execute(db);
  await sql`drop function guard_event_virtual_lobby_revision()`.execute(db);
  await sql`drop table event_virtual_lobby_revision`.execute(db);
  await sql`alter table event_virtual_lobby_entry
    drop constraint event_virtual_lobby_entry_revision_scope_uq`.execute(db);
}
