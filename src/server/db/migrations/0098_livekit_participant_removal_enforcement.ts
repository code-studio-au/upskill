import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_room_operation
    add column "removalEnforcedUntil" timestamptz`.execute(db);
  await sql`update event_virtual_room_operation as operation
    set "removalEnforcedUntil" = coalesce(
      (
        select lobby."credentialExpiresAt"
        from event_virtual_lobby_entry as lobby
        where lobby.id = operation."lobbyEntryId"
      ),
      (
        select reservation."credentialExpiresAt"
        from event_virtual_presenter_credential_reservation as reservation
        where reservation."roomId" = operation."roomId"
          and reservation."userId" = operation."presenterUserId"
      ),
      operation."createdAt"
    )
    where operation.kind = 'remove_participant'`.execute(db);
  await sql`alter table event_virtual_room_operation
    add constraint event_virtual_room_operation_removal_enforcement_ck check (
      (
        kind = 'remove_participant'
        and "removalEnforcedUntil" is not null
      )
      or (
        kind in ('ensure_room', 'close_room')
        and "removalEnforcedUntil" is null
      )
    )`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_room_operation
    drop constraint event_virtual_room_operation_removal_enforcement_ck,
    drop column "removalEnforcedUntil"`.execute(db);
}
