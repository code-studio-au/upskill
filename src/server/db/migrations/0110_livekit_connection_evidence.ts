import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_room
    add constraint event_virtual_room_presence_scope_uq unique (
      id, "eventSessionId", generation
    )`.execute(db);
  await sql`alter table event_virtual_lobby_entry
    add constraint event_virtual_lobby_entry_presence_scope_uq unique (
      id, "eventVirtualJoinAccessId", "eventOccurrenceId", "eventSessionId",
      "roomGeneration", "eventParticipationId"
    )`.execute(db);

  await sql`create table livekit_participant_webhook_receipt (
    id text primary key,
    provider text not null,
    "providerEnvironment" text not null,
    "providerEventId" text not null,
    "eventType" text not null,
    "payloadDigest" text not null,
    "providerCreatedAt" timestamptz not null,
    "receivedAt" timestamptz not null,
    "providerRoomSid" text not null,
    "providerRoomName" text not null,
    "providerParticipantSid" text not null,
    "participantIdentityDigest" text not null,
    "processingState" text not null,
    "processedAt" timestamptz,
    "matchedRoomId" text,
    "matchedLobbyEntryId" text,
    "matchedEventVirtualJoinAccessId" text,
    "matchedEventOccurrenceId" text,
    "matchedEventSessionId" text,
    "matchedRoomGeneration" integer,
    "matchedEventParticipationId" text,
    constraint livekit_participant_webhook_receipt_event_uq unique (
      "providerEnvironment", "providerEventId"
    ),
    constraint livekit_participant_webhook_receipt_room_fk foreign key (
      "matchedRoomId", "matchedEventSessionId", "matchedRoomGeneration"
    ) references event_virtual_room (
      id, "eventSessionId", generation
    ) on delete restrict,
    constraint livekit_participant_webhook_receipt_lobby_fk foreign key (
      "matchedLobbyEntryId", "matchedEventVirtualJoinAccessId",
      "matchedEventOccurrenceId", "matchedEventSessionId",
      "matchedRoomGeneration", "matchedEventParticipationId"
    ) references event_virtual_lobby_entry (
      id, "eventVirtualJoinAccessId", "eventOccurrenceId", "eventSessionId",
      "roomGeneration", "eventParticipationId"
    ) on delete restrict,
    constraint livekit_participant_webhook_receipt_provider_ck check (
      provider = 'livekit'
      and "providerEnvironment" in (
        'development', 'test', 'staging', 'production'
      )
    ),
    constraint livekit_participant_webhook_receipt_identity_ck check (
      "providerEventId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      and "providerRoomSid" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      and "providerParticipantSid" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      and char_length("providerRoomName") between 1 and 200
      and "providerRoomName" !~ '[[:cntrl:]]'
      and "payloadDigest" ~ '^[a-f0-9]{64}$'
      and "participantIdentityDigest" ~ '^[a-f0-9]{64}$'
      and "eventType" in (
        'participant_joined', 'participant_left',
        'participant_connection_aborted'
      )
    ),
    constraint livekit_participant_webhook_receipt_match_ck check (
      (
        "matchedRoomId" is null
        and "matchedLobbyEntryId" is null
        and "matchedEventVirtualJoinAccessId" is null
        and "matchedEventOccurrenceId" is null
        and "matchedEventSessionId" is null
        and "matchedRoomGeneration" is null
        and "matchedEventParticipationId" is null
      )
      or (
        "matchedRoomId" is not null
        and "matchedLobbyEntryId" is not null
        and "matchedEventVirtualJoinAccessId" is not null
        and "matchedEventOccurrenceId" is not null
        and "matchedEventSessionId" is not null
        and "matchedRoomGeneration" is not null
        and "matchedEventParticipationId" is not null
      )
    ),
    constraint livekit_participant_webhook_receipt_processing_ck check (
      (
        "processingState" = 'processing'
        and "processedAt" is null
        and "matchedRoomId" is null
      )
      or (
        "processingState" = 'processed'
        and "processedAt" is not null
        and "matchedRoomId" is not null
      )
      or (
        "processingState" in ('unmatched', 'ignored')
        and "processedAt" is not null
        and "matchedRoomId" is null
      )
    ),
    constraint livekit_participant_webhook_receipt_timeline_ck check (
      "processedAt" is null or "processedAt" >= "receivedAt"
    )
  )`.execute(db);
  await sql`create index livekit_participant_webhook_receipt_connection_idx
    on livekit_participant_webhook_receipt (
      "matchedRoomId", "providerParticipantSid", "providerCreatedAt", id
    )
    where "processingState" = 'processed'`.execute(db);

  await sql`create table event_virtual_connection_interval (
    id text primary key,
    "roomId" text not null,
    "eventVirtualJoinAccessId" text not null,
    "eventOccurrenceId" text not null,
    "eventSessionId" text not null,
    "roomGeneration" integer not null,
    "lobbyEntryId" text not null,
    "eventParticipationId" text not null,
    "providerParticipantSid" text not null,
    "participantIdentityDigest" text not null,
    "joinedReceiptId" text not null unique
      references livekit_participant_webhook_receipt(id) on delete restrict,
    "leftReceiptId" text unique
      references livekit_participant_webhook_receipt(id) on delete restrict,
    "joinedAt" timestamptz not null,
    "leftAt" timestamptz,
    "createdAt" timestamptz not null,
    "updatedAt" timestamptz not null,
    constraint event_virtual_connection_interval_participant_uq unique (
      "roomId", "providerParticipantSid"
    ),
    constraint event_virtual_connection_interval_room_fk foreign key (
      "roomId", "eventSessionId", "roomGeneration"
    ) references event_virtual_room (
      id, "eventSessionId", generation
    ) on delete restrict,
    constraint event_virtual_connection_interval_lobby_fk foreign key (
      "lobbyEntryId", "eventVirtualJoinAccessId", "eventOccurrenceId",
      "eventSessionId", "roomGeneration", "eventParticipationId"
    ) references event_virtual_lobby_entry (
      id, "eventVirtualJoinAccessId", "eventOccurrenceId", "eventSessionId",
      "roomGeneration", "eventParticipationId"
    ) on delete restrict,
    constraint event_virtual_connection_interval_identity_ck check (
      "providerParticipantSid" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      and "participantIdentityDigest" ~ '^[a-f0-9]{64}$'
    ),
    constraint event_virtual_connection_interval_timeline_ck check (
      "updatedAt" >= "createdAt"
      and ("leftAt" is null) = ("leftReceiptId" is null)
      and ("leftAt" is null or "leftAt" >= "joinedAt")
    )
  )`.execute(db);
  await sql`create index event_virtual_connection_interval_presence_idx
    on event_virtual_connection_interval (
      "eventVirtualJoinAccessId", "eventParticipationId", "joinedAt", id
    )`.execute(db);
  await sql`create index event_virtual_connection_interval_open_idx
    on event_virtual_connection_interval (
      "eventVirtualJoinAccessId", "eventParticipationId"
    ) where "leftAt" is null`.execute(db);

  await sql`create function guard_livekit_participant_webhook_receipt()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'INSERT' then
        if new."processingState" <> 'processing' then
          raise exception 'Participant webhook receipts must begin processing'
            using errcode = '23514';
        end if;
        return new;
      end if;
      if tg_op = 'DELETE' then
        if current_user in ('upskill_web', 'upskill_worker') then
          raise exception 'Participant webhook receipt evidence cannot be deleted'
            using errcode = '42501';
        end if;
        return old;
      end if;
      if old."processingState" <> 'processing'
        or new."processingState" not in ('processed', 'unmatched', 'ignored')
        or new."processedAt" is null then
        raise exception 'Participant webhook receipt transition is not allowed'
          using errcode = '23514';
      end if;
      if row(
        new.id, new.provider, new."providerEnvironment", new."providerEventId",
        new."eventType", new."payloadDigest", new."providerCreatedAt",
        new."receivedAt", new."providerRoomSid", new."providerRoomName",
        new."providerParticipantSid", new."participantIdentityDigest"
      ) is distinct from row(
        old.id, old.provider, old."providerEnvironment", old."providerEventId",
        old."eventType", old."payloadDigest", old."providerCreatedAt",
        old."receivedAt", old."providerRoomSid", old."providerRoomName",
        old."providerParticipantSid", old."participantIdentityDigest"
      ) then
        raise exception 'Participant webhook identity evidence is immutable'
          using errcode = '23514';
      end if;
      return new;
    end
    $$`.execute(db);
  await sql`create trigger livekit_participant_webhook_receipt_guard_trg
    before insert or update or delete on livekit_participant_webhook_receipt
    for each row execute function guard_livekit_participant_webhook_receipt()`.execute(
    db,
  );

  await sql`create function guard_event_virtual_connection_interval()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'DELETE' then
        if current_user in ('upskill_web', 'upskill_worker') then
          raise exception 'Connection interval evidence cannot be deleted'
            using errcode = '42501';
        end if;
        return old;
      end if;
      if tg_op = 'UPDATE' then
        if old."leftAt" is not null
          or new."leftAt" is null
          or new."leftReceiptId" is null
          or row(
            new.id, new."roomId", new."eventVirtualJoinAccessId",
            new."eventOccurrenceId", new."eventSessionId", new."roomGeneration",
            new."lobbyEntryId", new."eventParticipationId",
            new."providerParticipantSid", new."participantIdentityDigest",
            new."joinedReceiptId", new."joinedAt", new."createdAt"
          ) is distinct from row(
            old.id, old."roomId", old."eventVirtualJoinAccessId",
            old."eventOccurrenceId", old."eventSessionId", old."roomGeneration",
            old."lobbyEntryId", old."eventParticipationId",
            old."providerParticipantSid", old."participantIdentityDigest",
            old."joinedReceiptId", old."joinedAt", old."createdAt"
          ) then
          raise exception 'Connection interval transition is not allowed'
            using errcode = '23514';
        end if;
      end if;
      if not exists (
        select 1 from livekit_participant_webhook_receipt receipt
        where receipt.id = new."joinedReceiptId"
          and receipt."eventType" = 'participant_joined'
          and receipt."processingState" = 'processed'
          and receipt."matchedRoomId" = new."roomId"
          and receipt."matchedLobbyEntryId" = new."lobbyEntryId"
          and receipt."matchedEventParticipationId" = new."eventParticipationId"
          and receipt."providerParticipantSid" = new."providerParticipantSid"
          and receipt."participantIdentityDigest" = new."participantIdentityDigest"
          and receipt."providerCreatedAt" = new."joinedAt"
      ) then
        raise exception 'Connection interval join receipt does not match'
          using errcode = '23514';
      end if;
      if new."leftReceiptId" is not null and not exists (
        select 1 from livekit_participant_webhook_receipt receipt
        where receipt.id = new."leftReceiptId"
          and receipt."eventType" in (
            'participant_left', 'participant_connection_aborted'
          )
          and receipt."processingState" = 'processed'
          and receipt."matchedRoomId" = new."roomId"
          and receipt."matchedLobbyEntryId" = new."lobbyEntryId"
          and receipt."matchedEventParticipationId" = new."eventParticipationId"
          and receipt."providerParticipantSid" = new."providerParticipantSid"
          and receipt."participantIdentityDigest" = new."participantIdentityDigest"
          and receipt."providerCreatedAt" = new."leftAt"
      ) then
        raise exception 'Connection interval leave receipt does not match'
          using errcode = '23514';
      end if;
      return new;
    end
    $$`.execute(db);
  await sql`create trigger event_virtual_connection_interval_guard_trg
    before insert or update or delete on event_virtual_connection_interval
    for each row execute function guard_event_virtual_connection_interval()`.execute(
    db,
  );

  await sql`do $$
    begin
      if exists (select 1 from pg_roles where rolname = 'upskill_web') then
        execute 'revoke delete on table livekit_participant_webhook_receipt from upskill_web';
        execute 'revoke delete on table event_virtual_connection_interval from upskill_web';
      end if;
      if exists (select 1 from pg_roles where rolname = 'upskill_worker') then
        execute 'revoke delete on table livekit_participant_webhook_receipt from upskill_worker';
        execute 'revoke delete on table event_virtual_connection_interval from upskill_worker';
      end if;
    end
    $$`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop trigger event_virtual_connection_interval_guard_trg
    on event_virtual_connection_interval`.execute(db);
  await sql`drop function guard_event_virtual_connection_interval()`.execute(
    db,
  );
  await sql`drop trigger livekit_participant_webhook_receipt_guard_trg
    on livekit_participant_webhook_receipt`.execute(db);
  await sql`drop function guard_livekit_participant_webhook_receipt()`.execute(
    db,
  );
  await sql`drop table event_virtual_connection_interval`.execute(db);
  await sql`drop table livekit_participant_webhook_receipt`.execute(db);
  await sql`alter table event_virtual_lobby_entry
    drop constraint event_virtual_lobby_entry_presence_scope_uq`.execute(db);
  await sql`alter table event_virtual_room
    drop constraint event_virtual_room_presence_scope_uq`.execute(db);
}
