import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_recording
    add constraint event_virtual_recording_id_room_uq unique (id, "roomId")`.execute(
    db,
  );
  await sql`alter table event_virtual_room_operation
    drop constraint event_virtual_room_operation_kind_ck,
    drop constraint event_virtual_room_operation_target_ck,
    drop constraint event_virtual_room_operation_removal_enforcement_ck,
    add column "recordingId" text,
    add constraint event_virtual_room_operation_recording_fk foreign key (
      "recordingId", "roomId"
    ) references event_virtual_recording (id, "roomId") on delete restrict,
    add constraint event_virtual_room_operation_kind_ck check (
      kind in (
        'ensure_room', 'close_room', 'remove_participant',
        'start_recording', 'stop_recording'
      )
    ),
    add constraint event_virtual_room_operation_target_ck check (
      (
        kind in ('ensure_room', 'close_room')
        and "targetKey" = 'room'
        and "lobbyEntryId" is null
        and "presenterUserId" is null
        and "participantIdentity" is null
        and "recordingId" is null
      )
      or (
        kind = 'remove_participant'
        and "targetKey" = "lobbyEntryId"
        and "lobbyEntryId" is not null
        and "presenterUserId" is null
        and "participantIdentity" ~ '^attendee:[A-Za-z0-9_-]{43}$'
        and "recordingId" is null
      )
      or (
        kind = 'remove_participant'
        and "targetKey" = 'presenter:' || "presenterUserId"
        and "lobbyEntryId" is null
        and "presenterUserId" is not null
        and "participantIdentity" ~ '^staff_[0-9a-f]{64}$'
        and "recordingId" is null
      )
      or (
        kind in ('start_recording', 'stop_recording')
        and "targetKey" = "recordingId"
        and "recordingId" is not null
        and "lobbyEntryId" is null
        and "presenterUserId" is null
        and "participantIdentity" is null
      )
    ),
    add constraint event_virtual_room_operation_removal_enforcement_ck check (
      (
        kind = 'remove_participant'
        and "removalEnforcedUntil" is not null
      )
      or (
        kind <> 'remove_participant'
        and "removalEnforcedUntil" is null
      )
    )`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`delete from event_virtual_room_operation
    where kind in ('start_recording', 'stop_recording')`.execute(db);
  await sql`alter table event_virtual_room_operation
    drop constraint event_virtual_room_operation_removal_enforcement_ck,
    drop constraint event_virtual_room_operation_target_ck,
    drop constraint event_virtual_room_operation_kind_ck,
    drop constraint event_virtual_room_operation_recording_fk,
    drop column "recordingId",
    add constraint event_virtual_room_operation_kind_ck check (
      kind in ('ensure_room', 'close_room', 'remove_participant')
    ),
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
    ),
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
  await sql`alter table event_virtual_recording
    drop constraint event_virtual_recording_id_room_uq`.execute(db);
}
