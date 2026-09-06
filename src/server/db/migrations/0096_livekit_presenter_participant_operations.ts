import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_room_operation
    drop constraint event_virtual_room_operation_target_ck,
    add column "presenterUserId" text references "user"(id) on delete restrict,
    add constraint event_virtual_room_operation_target_ck check (
      (
        kind in ('ensure_room', 'close_room')
        and "targetKey" = 'room'
        and "lobbyEntryId" is null
        and "presenterUserId" is null
        and "participantIdentity" is null
      )
      or (
        kind = 'remove_participant'
        and "targetKey" = "lobbyEntryId"
        and "lobbyEntryId" is not null
        and "presenterUserId" is null
        and "participantIdentity" ~ '^attendee:[A-Za-z0-9_-]{43}$'
      )
      or (
        kind = 'remove_participant'
        and "targetKey" = 'presenter:' || "presenterUserId"
        and "lobbyEntryId" is null
        and "presenterUserId" is not null
        and "participantIdentity" ~ '^staff_[0-9a-f]{64}$'
      )
    )`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`delete from event_virtual_room_operation
    where kind = 'remove_participant'
      and "presenterUserId" is not null`.execute(db);
  await sql`alter table event_virtual_room_operation
    drop constraint event_virtual_room_operation_target_ck,
    drop column "presenterUserId",
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
    )`.execute(db);
}
