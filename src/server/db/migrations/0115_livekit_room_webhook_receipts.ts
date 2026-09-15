import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_room
    drop constraint event_virtual_room_actor_time_ck,
    add constraint event_virtual_room_actor_time_ck check (
      (("startedAt" is null) = ("startedByUserId" is null))
      and (("lockedAt" is null) = ("lockedByUserId" is null))
      and (("reopenedAt" is null) = ("reopenedByUserId" is null))
      and ("endedAt" is not null or "endedByUserId" is null)
      and (("replacedAt" is null) = ("replacedByUserId" is null))
    )`.execute(db);
  await sql`alter table event_virtual_recording
    drop constraint event_virtual_recording_actor_ck,
    add constraint event_virtual_recording_actor_ck check (
      ("stopRequestedAt" is not null or "stopRequestedByUserId" is null)
      and (
        ("deletedAt" is null and "deletedByUserId" is null)
        or "deletedAt" is not null
      )
      and ("deletedAt" is null or "deletionReason" is not null)
    )`.execute(db);

  await sql`create table livekit_room_webhook_receipt (
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
    "processingState" text not null,
    "processedAt" timestamptz,
    "matchedRoomId" text,
    "matchedEventSessionId" text,
    "matchedRoomGeneration" integer,
    constraint livekit_room_webhook_receipt_event_uq unique (
      "providerEnvironment", "providerEventId"
    ),
    constraint livekit_room_webhook_receipt_room_fk foreign key (
      "matchedRoomId", "matchedEventSessionId", "matchedRoomGeneration"
    ) references event_virtual_room (
      id, "eventSessionId", generation
    ) on delete restrict,
    constraint livekit_room_webhook_receipt_provider_ck check (
      provider = 'livekit'
      and "providerEnvironment" in (
        'development', 'test', 'staging', 'production'
      )
    ),
    constraint livekit_room_webhook_receipt_identity_ck check (
      "providerEventId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      and "providerRoomSid" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      and char_length("providerRoomName") between 1 and 200
      and "providerRoomName" !~ '[[:cntrl:]]'
      and "payloadDigest" ~ '^[a-f0-9]{64}$'
      and "eventType" in ('room_started', 'room_finished')
    ),
    constraint livekit_room_webhook_receipt_match_ck check (
      (
        "matchedRoomId" is null
        and "matchedEventSessionId" is null
        and "matchedRoomGeneration" is null
      )
      or (
        "matchedRoomId" is not null
        and "matchedEventSessionId" is not null
        and "matchedRoomGeneration" is not null
      )
    ),
    constraint livekit_room_webhook_receipt_processing_ck check (
      (
        "processingState" = 'processing'
        and "processedAt" is null
        and "matchedRoomId" is null
      )
      or (
        "processingState" in ('processed', 'ignored')
        and "processedAt" is not null
        and "matchedRoomId" is not null
      )
      or (
        "processingState" = 'unmatched'
        and "processedAt" is not null
        and "matchedRoomId" is null
      )
    ),
    constraint livekit_room_webhook_receipt_timeline_ck check (
      "processedAt" is null or "processedAt" >= "receivedAt"
    )
  )`.execute(db);

  await sql`create index livekit_room_webhook_receipt_room_idx
    on livekit_room_webhook_receipt (
      "matchedRoomId", "providerCreatedAt", id
    ) where "matchedRoomId" is not null`.execute(db);

  await sql`create function guard_livekit_room_webhook_receipt()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'INSERT' then
        if new."processingState" <> 'processing' then
          raise exception 'Room webhook receipts must begin processing'
            using errcode = '23514';
        end if;
        return new;
      end if;
      if tg_op = 'DELETE' then
        if current_user in ('upskill_web', 'upskill_worker') then
          raise exception 'Room webhook receipt evidence cannot be deleted'
            using errcode = '42501';
        end if;
        return old;
      end if;
      if old."processingState" <> 'processing'
        or new."processingState" not in ('processed', 'unmatched', 'ignored')
        or new."processedAt" is null then
        raise exception 'Room webhook receipt transition is not allowed'
          using errcode = '23514';
      end if;
      if row(
        new.id, new.provider, new."providerEnvironment",
        new."providerEventId", new."eventType", new."payloadDigest",
        new."providerCreatedAt", new."receivedAt", new."providerRoomSid",
        new."providerRoomName"
      ) is distinct from row(
        old.id, old.provider, old."providerEnvironment",
        old."providerEventId", old."eventType", old."payloadDigest",
        old."providerCreatedAt", old."receivedAt", old."providerRoomSid",
        old."providerRoomName"
      ) then
        raise exception 'Room webhook identity evidence is immutable'
          using errcode = '23514';
      end if;
      return new;
    end
    $$`.execute(db);
  await sql`create trigger livekit_room_webhook_receipt_guard_trg
    before insert or update or delete on livekit_room_webhook_receipt
    for each row execute function guard_livekit_room_webhook_receipt()`.execute(
    db,
  );

  await sql`do $$
    begin
      if exists (select 1 from pg_roles where rolname = 'upskill_web') then
        execute 'revoke delete on table livekit_room_webhook_receipt from upskill_web';
      end if;
      if exists (select 1 from pg_roles where rolname = 'upskill_worker') then
        execute 'revoke delete on table livekit_room_webhook_receipt from upskill_worker';
      end if;
    end
    $$`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop trigger livekit_room_webhook_receipt_guard_trg
    on livekit_room_webhook_receipt`.execute(db);
  await sql`drop function guard_livekit_room_webhook_receipt()`.execute(db);
  await sql`drop table livekit_room_webhook_receipt`.execute(db);
  await sql`alter table event_virtual_room
    drop constraint event_virtual_room_actor_time_ck,
    add constraint event_virtual_room_actor_time_ck check (
      (("startedAt" is null) = ("startedByUserId" is null))
      and (("lockedAt" is null) = ("lockedByUserId" is null))
      and (("reopenedAt" is null) = ("reopenedByUserId" is null))
      and (("endedAt" is null) = ("endedByUserId" is null))
      and (("replacedAt" is null) = ("replacedByUserId" is null))
    )`.execute(db);
  await sql`alter table event_virtual_recording
    drop constraint event_virtual_recording_actor_ck,
    add constraint event_virtual_recording_actor_ck check (
      (("stopRequestedAt" is null) = ("stopRequestedByUserId" is null))
      and (
        ("deletedAt" is null and "deletedByUserId" is null)
        or "deletedAt" is not null
      )
      and ("deletedAt" is null or "deletionReason" is not null)
    )`.execute(db);
}
