import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`create table livekit_webhook_receipt (
    id text primary key,
    provider text not null,
    "providerEnvironment" text not null,
    "providerEventId" text not null,
    "eventType" text not null,
    "payloadDigest" text not null,
    "providerCreatedAt" timestamptz not null,
    "receivedAt" timestamptz not null,
    "processingState" text not null,
    "processingAttempts" integer not null default 0,
    "lastAttemptAt" timestamptz,
    "processedAt" timestamptz,
    "lastErrorCode" text,
    "matchedRecordingId" text,
    "matchedRoomId" text,
    "providerEgressId" text not null,
    "providerRoomName" text not null,
    "normalizedStatus" text,
    "startedAt" timestamptz,
    "endedAt" timestamptz,
    "fileSizeBytes" bigint,
    "durationNanoseconds" bigint,
    "failureCode" text,
    constraint livekit_webhook_receipt_event_uq unique (
      "providerEnvironment", "providerEventId"
    ),
    constraint livekit_webhook_receipt_recording_fk foreign key (
      "matchedRecordingId", "matchedRoomId"
    ) references event_virtual_recording (id, "roomId") on delete restrict,
    constraint livekit_webhook_receipt_provider_ck check (
      provider = 'livekit'
      and "providerEnvironment" in (
        'development', 'test', 'staging', 'production'
      )
    ),
    constraint livekit_webhook_receipt_identity_ck check (
      "providerEventId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      and "providerEgressId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      and char_length("providerRoomName") between 1 and 200
      and "providerRoomName" !~ '[[:cntrl:]]'
      and "payloadDigest" ~ '^[a-f0-9]{64}$'
      and "eventType" in (
        'egress_started', 'egress_updated', 'egress_ended'
      )
    ),
    constraint livekit_webhook_receipt_match_ck check (
      ("matchedRecordingId" is null) = ("matchedRoomId" is null)
    ),
    constraint livekit_webhook_receipt_processing_ck check (
      "processingAttempts" >= 0
      and (
        (
          "processingState" = 'processing'
          and "processedAt" is null
          and "lastErrorCode" is null
          and (
            (
              "matchedRecordingId" is null
              and "normalizedStatus" is null
              and "processingAttempts" = 0
              and "lastAttemptAt" is null
            )
            or (
              "matchedRecordingId" is not null
              and "normalizedStatus" is not null
              and "processingAttempts" >= 1
              and "lastAttemptAt" is not null
            )
          )
        )
        or (
          "processingState" = 'pending'
          and "matchedRecordingId" is not null
          and "normalizedStatus" is not null
          and "processingAttempts" = 0
          and "lastAttemptAt" is null
          and "processedAt" is null
          and "lastErrorCode" is null
        )
        or (
          "processingState" = 'processed'
          and "matchedRecordingId" is not null
          and "normalizedStatus" is not null
          and "processingAttempts" >= 1
          and "lastAttemptAt" is not null
          and "processedAt" is not null
          and "lastErrorCode" is null
        )
        or (
          "processingState" = 'unmatched'
          and "matchedRecordingId" is null
          and "processingAttempts" = 0
          and "lastAttemptAt" is null
          and "processedAt" is not null
          and "lastErrorCode" is null
        )
        or (
          "processingState" = 'failed'
          and "matchedRecordingId" is not null
          and "normalizedStatus" is not null
          and "processingAttempts" >= 1
          and "lastAttemptAt" is not null
          and "processedAt" is null
          and "lastErrorCode" ~ '^[a-z0-9_]{1,100}$'
        )
      )
    ),
    constraint livekit_webhook_receipt_snapshot_ck check (
      (
        "normalizedStatus" is null
        and "startedAt" is null
        and "endedAt" is null
        and "fileSizeBytes" is null
        and "durationNanoseconds" is null
        and "failureCode" is null
      )
      or (
        "matchedRecordingId" is not null
        and "normalizedStatus" in (
          'starting', 'active', 'stopping', 'complete', 'failed'
        )
        and ("fileSizeBytes" is null) = ("durationNanoseconds" is null)
        and ("fileSizeBytes" is null or "fileSizeBytes" >= 0)
        and ("durationNanoseconds" is null or "durationNanoseconds" >= 0)
        and (
          "startedAt" is null
          or "endedAt" is null
          or "endedAt" >= "startedAt"
        )
        and (
          (
            "normalizedStatus" = 'complete'
            and "startedAt" is not null
            and "endedAt" is not null
            and "fileSizeBytes" is not null
            and "failureCode" is null
          )
          or (
            "normalizedStatus" = 'failed'
            and "fileSizeBytes" is null
            and "failureCode" ~ '^[a-z0-9_]{1,100}$'
          )
          or (
            "normalizedStatus" in ('starting', 'active', 'stopping')
            and ("normalizedStatus" <> 'active' or "startedAt" is not null)
            and "endedAt" is null
            and "fileSizeBytes" is null
            and "failureCode" is null
          )
        )
      )
    ),
    constraint livekit_webhook_receipt_timeline_ck check (
      ("lastAttemptAt" is null or "lastAttemptAt" >= "receivedAt")
      and (
        "processedAt" is null
        or "processedAt" >= coalesce("lastAttemptAt", "receivedAt")
      )
    )
  )`.execute(db);

  await sql`create index livekit_webhook_receipt_processing_idx
    on livekit_webhook_receipt (
      "processingState", "receivedAt", id
    )
    where "processingState" in ('pending', 'failed')`.execute(db);

  await sql`create function guard_livekit_webhook_receipt_evidence()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'INSERT' then
        if new."processingState" is distinct from 'processing' then
          raise exception 'Webhook receipts must begin in processing state'
            using errcode = '23514';
        end if;
        return new;
      end if;

      if tg_op = 'DELETE' then
        if current_user in ('upskill_web', 'upskill_worker') then
          raise exception 'Webhook receipt evidence cannot be physically deleted'
            using errcode = '42501';
        end if;
        return old;
      end if;

      if row(
        new.id, new.provider, new."providerEnvironment", new."providerEventId",
        new."eventType", new."payloadDigest", new."providerCreatedAt",
        new."receivedAt", new."providerEgressId", new."providerRoomName"
      ) is distinct from row(
        old.id, old.provider, old."providerEnvironment", old."providerEventId",
        old."eventType", old."payloadDigest", old."providerCreatedAt",
        old."receivedAt", old."providerEgressId", old."providerRoomName"
      ) then
        raise exception 'Webhook receipt identity evidence is immutable'
          using errcode = '23514';
      end if;

      if row(
        new."matchedRecordingId", new."matchedRoomId", new."normalizedStatus",
        new."startedAt", new."endedAt", new."fileSizeBytes",
        new."durationNanoseconds", new."failureCode"
      ) is distinct from row(
        old."matchedRecordingId", old."matchedRoomId", old."normalizedStatus",
        old."startedAt", old."endedAt", old."fileSizeBytes",
        old."durationNanoseconds", old."failureCode"
      ) and not (
        old."processingState" = 'processing'
        and old."processingAttempts" = 0
        and old."matchedRecordingId" is null
        and new."processingState" = 'pending'
      ) then
        raise exception 'Webhook receipt normalized evidence is immutable'
          using errcode = '23514';
      end if;

      if new is not distinct from old then
        return new;
      end if;
      if new."processingState" is not distinct from old."processingState" then
        raise exception 'Webhook receipt updates require a state transition'
          using errcode = '23514';
      end if;

      if old."processingState" = 'processing'
        and old."processingAttempts" = 0
        and old."matchedRecordingId" is null then
        if new."processingState" not in ('pending', 'unmatched')
          or new."processingAttempts" <> 0
          or new."lastAttemptAt" is not null then
          raise exception 'Initial webhook receipt transition is not allowed'
            using errcode = '23514';
        end if;
      elsif old."processingState" in ('pending', 'failed') then
        if new."processingState" <> 'processing'
          or new."processingAttempts" <> old."processingAttempts" + 1
          or new."lastAttemptAt" is null
          or (
            old."lastAttemptAt" is not null
            and new."lastAttemptAt" <= old."lastAttemptAt"
          ) then
          raise exception 'Webhook receipt claim transition is not allowed'
            using errcode = '23514';
        end if;
      elsif old."processingState" = 'processing'
        and old."matchedRecordingId" is not null then
        if new."processingState" not in ('processed', 'failed')
          or new."processingAttempts" <> old."processingAttempts"
          or new."lastAttemptAt" is distinct from old."lastAttemptAt" then
          raise exception 'Webhook receipt completion transition is not allowed'
            using errcode = '23514';
        end if;
      else
        raise exception 'Terminal webhook receipt evidence is immutable'
          using errcode = '23514';
      end if;
      return new;
    end
    $$`.execute(db);
  await sql`create trigger livekit_webhook_receipt_guard_trg
    before insert or update or delete on livekit_webhook_receipt
    for each row execute function guard_livekit_webhook_receipt_evidence()`.execute(
    db,
  );

  await sql`do $$
    begin
      if exists (select 1 from pg_roles where rolname = 'upskill_web') then
        execute 'revoke delete on table livekit_webhook_receipt from upskill_web';
      end if;
      if exists (select 1 from pg_roles where rolname = 'upskill_worker') then
        execute 'revoke delete on table livekit_webhook_receipt from upskill_worker';
      end if;
    end
    $$`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop trigger livekit_webhook_receipt_guard_trg
    on livekit_webhook_receipt`.execute(db);
  await sql`drop function guard_livekit_webhook_receipt_evidence()`.execute(db);
  await sql`drop table livekit_webhook_receipt`.execute(db);
}
