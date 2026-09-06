import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_lobby_entry
    add column "credentialExpiresAt" timestamptz,
    add constraint event_virtual_lobby_entry_credential_expiry_ck check (
      "credentialExpiresAt" is null
      or (
        "firstTokenIssuedAt" is not null
        and "credentialExpiresAt" > "firstTokenIssuedAt"
      )
    )`.execute(db);
  await sql`create index event_virtual_lobby_entry_active_credential_idx
    on event_virtual_lobby_entry (
      "eventVirtualJoinAccessId", "credentialExpiresAt"
    )
    where state = 'token_issued' and "credentialExpiresAt" is not null`.execute(
    db,
  );

  await sql`alter table event_virtual_room_operation
    drop constraint event_virtual_room_operation_kind_uq,
    drop constraint event_virtual_room_operation_kind_ck,
    add column "targetKey" text not null default 'room',
    add column "lobbyEntryId" text references event_virtual_lobby_entry(id)
      on delete restrict,
    add column "participantIdentity" text,
    add constraint event_virtual_room_operation_kind_ck check (
      kind in ('ensure_room', 'close_room', 'remove_participant')
    ),
    add constraint event_virtual_room_operation_target_ck check (
      (
        kind in ('ensure_room', 'close_room')
        and "targetKey" = 'room'
        and "lobbyEntryId" is null
        and "participantIdentity" is null
      )
      or (
        kind = 'remove_participant'
        and "targetKey" = "lobbyEntryId"
        and "lobbyEntryId" is not null
        and "participantIdentity" ~ '^attendee:[A-Za-z0-9_-]{43}$'
      )
    ),
    add constraint event_virtual_room_operation_target_uq unique (
      "roomId", kind, "targetKey"
    )`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`delete from event_virtual_room_operation
    where kind = 'remove_participant'`.execute(db);
  await sql`alter table event_virtual_room_operation
    drop constraint event_virtual_room_operation_target_uq,
    drop constraint event_virtual_room_operation_target_ck,
    drop constraint event_virtual_room_operation_kind_ck,
    drop column "participantIdentity",
    drop column "lobbyEntryId",
    drop column "targetKey",
    add constraint event_virtual_room_operation_kind_uq unique ("roomId", kind),
    add constraint event_virtual_room_operation_kind_ck check (
      kind in ('ensure_room', 'close_room')
    )`.execute(db);
  await sql`drop index event_virtual_lobby_entry_active_credential_idx`.execute(
    db,
  );
  await sql`alter table event_virtual_lobby_entry
    drop constraint event_virtual_lobby_entry_credential_expiry_ck,
    drop column "credentialExpiresAt"`.execute(db);
}
