import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_room
    add constraint event_virtual_room_recording_scope_uq
    unique (
      id, "eventSessionId", generation, "recordingMode",
      "recordingRetentionDays"
    )`.execute(db);

  await sql`create table event_virtual_recording (
    id text primary key,
    "roomId" text not null,
    "eventSessionId" text not null,
    "roomGeneration" integer not null,
    provider text not null,
    "recordingMode" text not null,
    status text not null,
    "providerEgressId" text unique,
    "storageObjectKey" text not null unique,
    "retentionDays" integer not null,
    "attendeeNoticeDigest" text not null,
    "presenterNoticeDigest" text not null,
    "requestedByUserId" text not null references "user"(id) on delete restrict,
    "requestedAt" timestamptz not null,
    "startedAt" timestamptz,
    "stopRequestedByUserId" text references "user"(id) on delete restrict,
    "stopRequestedAt" timestamptz,
    "endedAt" timestamptz,
    "completedAt" timestamptz,
    "fileSizeBytes" bigint,
    "durationNanoseconds" bigint,
    "retentionDeadline" timestamptz,
    "failureCode" text,
    "deletedByUserId" text references "user"(id) on delete restrict,
    "deletedAt" timestamptz,
    "deletionReason" text,
    "updatedAt" timestamptz not null,
    constraint event_virtual_recording_room_fk foreign key (
      "roomId", "eventSessionId", "roomGeneration", "recordingMode",
      "retentionDays"
    ) references event_virtual_room (
      id, "eventSessionId", generation, "recordingMode",
      "recordingRetentionDays"
    ) on delete restrict,
    constraint event_virtual_recording_room_uq unique ("roomId"),
    constraint event_virtual_recording_provider_ck check (provider = 'livekit'),
    constraint event_virtual_recording_generation_ck check (
      "roomGeneration" >= 1
    ),
    constraint event_virtual_recording_status_ck check (
      status in (
        'requested', 'starting', 'active', 'stopping', 'complete', 'failed',
        'deleted'
      )
    ),
    constraint event_virtual_recording_provider_id_ck check (
      "providerEgressId" is null
      or (
        char_length("providerEgressId") between 1 and 200
        and "providerEgressId" ~ '^[A-Za-z0-9_-]+$'
      )
    ),
    constraint event_virtual_recording_storage_key_ck check (
      char_length("storageObjectKey") between 1 and 1024
      and "storageObjectKey" ~ '^recordings/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*[.]mp4$'
    ),
    constraint event_virtual_recording_policy_ck check (
      "recordingMode" = 'automatic'
      and "retentionDays" between 1 and 3650
      and "attendeeNoticeDigest" ~ '^[A-Za-z0-9_-]{43}$'
      and "presenterNoticeDigest" ~ '^[A-Za-z0-9_-]{43}$'
    ),
    constraint event_virtual_recording_actor_ck check (
      (("stopRequestedAt" is null) = ("stopRequestedByUserId" is null))
      and (
        ("deletedAt" is null and "deletedByUserId" is null)
        or "deletedAt" is not null
      )
      and ("deletedAt" is null or "deletionReason" is not null)
    ),
    constraint event_virtual_recording_output_ck check (
      ("fileSizeBytes" is null) = ("durationNanoseconds" is null)
      and ("fileSizeBytes" is null or "fileSizeBytes" >= 0)
      and ("durationNanoseconds" is null or "durationNanoseconds" >= 0)
    ),
    constraint event_virtual_recording_timeline_ck check (
      "updatedAt" >= "requestedAt"
      and ("startedAt" is null or "startedAt" >= "requestedAt")
      and (
        "stopRequestedAt" is null
        or "stopRequestedAt" >= "requestedAt"
      )
      and (
        "endedAt" is null
        or "endedAt" >= coalesce("startedAt", "requestedAt")
      )
      and (
        "completedAt" is null
        or "completedAt" >= coalesce("endedAt", "startedAt", "requestedAt")
      )
      and (
        "retentionDeadline" is null
        or (
          "completedAt" is not null
          and "retentionDeadline" =
            "completedAt" + "retentionDays" * interval '24 hours'
        )
      )
      and (
        "deletedAt" is null
        or (
          "deletedAt" >= "completedAt"
          and (
            "deletionReason" <> 'retention_expired'
            or "deletedAt" >= "retentionDeadline"
          )
        )
      )
    ),
    constraint event_virtual_recording_state_ck check (
      (
        status = 'requested'
        and "providerEgressId" is null
        and "startedAt" is null
        and "stopRequestedAt" is null
        and "endedAt" is null
        and "completedAt" is null
        and "fileSizeBytes" is null
        and "retentionDeadline" is null
        and "failureCode" is null
        and "deletedAt" is null
        and "deletionReason" is null
      )
      or (
        status in ('starting', 'active', 'stopping')
        and "providerEgressId" is not null
        and (status <> 'active' or "startedAt" is not null)
        and (
          (status = 'stopping' and "stopRequestedAt" is not null)
          or (status in ('starting', 'active') and "stopRequestedAt" is null)
        )
        and "endedAt" is null
        and "completedAt" is null
        and "fileSizeBytes" is null
        and "retentionDeadline" is null
        and "failureCode" is null
        and "deletedAt" is null
        and "deletionReason" is null
      )
      or (
        status = 'complete'
        and "providerEgressId" is not null
        and "startedAt" is not null
        and "endedAt" is not null
        and "completedAt" is not null
        and "fileSizeBytes" is not null
        and "retentionDeadline" is not null
        and "failureCode" is null
        and "deletedAt" is null
        and "deletionReason" is null
      )
      or (
        status = 'failed'
        and "completedAt" is not null
        and "fileSizeBytes" is null
        and "retentionDeadline" is null
        and "failureCode" ~ '^[a-z0-9_]{1,100}$'
        and "deletedAt" is null
        and "deletionReason" is null
      )
      or (
        status = 'deleted'
        and "providerEgressId" is not null
        and "startedAt" is not null
        and "endedAt" is not null
        and "completedAt" is not null
        and "fileSizeBytes" is not null
        and "retentionDeadline" is not null
        and "failureCode" is null
        and "deletedAt" is not null
        and "deletionReason" ~ '^[a-z0-9_]{1,100}$'
      )
    )
  )`.execute(db);

  await sql`create index event_virtual_recording_status_idx
    on event_virtual_recording (status, "updatedAt")
    where status not in ('complete', 'failed', 'deleted')`.execute(db);
  await sql`create index event_virtual_recording_retention_idx
    on event_virtual_recording ("retentionDeadline")
    where status = 'complete'`.execute(db);

  await sql`create function guard_event_virtual_recording_evidence()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'DELETE' then
        if current_user in ('upskill_web', 'upskill_worker') then
          raise exception 'Recording evidence cannot be physically deleted'
            using errcode = '42501';
        end if;
        return old;
      end if;

      if row(
        new.id, new."roomId", new."eventSessionId", new."roomGeneration",
        new.provider, new."recordingMode", new."storageObjectKey",
        new."retentionDays", new."attendeeNoticeDigest",
        new."presenterNoticeDigest", new."requestedByUserId", new."requestedAt"
      ) is distinct from row(
        old.id, old."roomId", old."eventSessionId", old."roomGeneration",
        old.provider, old."recordingMode", old."storageObjectKey",
        old."retentionDays", old."attendeeNoticeDigest",
        old."presenterNoticeDigest", old."requestedByUserId", old."requestedAt"
      ) then
        raise exception 'Recording contractual evidence is immutable'
          using errcode = '23514';
      end if;

      if (
        (old."providerEgressId" is not null
          and new."providerEgressId" is distinct from old."providerEgressId")
        or (old."startedAt" is not null
          and new."startedAt" is distinct from old."startedAt")
        or (old."stopRequestedByUserId" is not null
          and new."stopRequestedByUserId" is distinct from old."stopRequestedByUserId")
        or (old."stopRequestedAt" is not null
          and new."stopRequestedAt" is distinct from old."stopRequestedAt")
        or (old."endedAt" is not null
          and new."endedAt" is distinct from old."endedAt")
        or (old."completedAt" is not null
          and new."completedAt" is distinct from old."completedAt")
        or (old."fileSizeBytes" is not null
          and new."fileSizeBytes" is distinct from old."fileSizeBytes")
        or (old."durationNanoseconds" is not null
          and new."durationNanoseconds" is distinct from old."durationNanoseconds")
        or (old."retentionDeadline" is not null
          and new."retentionDeadline" is distinct from old."retentionDeadline")
        or (old."failureCode" is not null
          and new."failureCode" is distinct from old."failureCode")
        or (old."deletedByUserId" is not null
          and new."deletedByUserId" is distinct from old."deletedByUserId")
        or (old."deletedAt" is not null
          and new."deletedAt" is distinct from old."deletedAt")
        or (old."deletionReason" is not null
          and new."deletionReason" is distinct from old."deletionReason")
      ) then
        raise exception 'Recorded lifecycle evidence is immutable'
          using errcode = '23514';
      end if;

      if new."updatedAt" < old."updatedAt" then
        raise exception 'Recording evidence update time cannot move backwards'
          using errcode = '23514';
      end if;

      if new.status is distinct from old.status and not (
        (old.status = 'requested' and new.status in ('starting', 'failed'))
        or (old.status = 'starting'
          and new.status in ('active', 'stopping', 'complete', 'failed'))
        or (old.status = 'active'
          and new.status in ('stopping', 'complete', 'failed'))
        or (old.status = 'stopping' and new.status in ('complete', 'failed'))
        or (old.status = 'complete' and new.status = 'deleted')
      ) then
        raise exception 'Recording lifecycle transition is not allowed'
          using errcode = '23514';
      end if;

      if old.status in ('failed', 'deleted') and new is distinct from old then
        raise exception 'Terminal recording evidence is immutable'
          using errcode = '23514';
      end if;
      if old.status = 'complete' then
        if new.status = 'complete' and new is distinct from old then
          raise exception 'Completed recording evidence is immutable'
            using errcode = '23514';
        end if;
        if new.status = 'deleted' and (
          to_jsonb(new) - array[
            'status', 'deletedByUserId', 'deletedAt', 'deletionReason', 'updatedAt'
          ] is distinct from
          to_jsonb(old) - array[
            'status', 'deletedByUserId', 'deletedAt', 'deletionReason', 'updatedAt'
          ]
        ) then
          raise exception 'Deletion cannot rewrite completed recording evidence'
            using errcode = '23514';
        end if;
      end if;
      return new;
    end
    $$`.execute(db);
  await sql`create trigger event_virtual_recording_guard_trg
    before update or delete on event_virtual_recording
    for each row execute function guard_event_virtual_recording_evidence()`.execute(
    db,
  );

  await sql`do $$
    begin
      if exists (select 1 from pg_roles where rolname = 'upskill_web') then
        execute 'revoke delete on table event_virtual_recording from upskill_web';
      end if;
      if exists (select 1 from pg_roles where rolname = 'upskill_worker') then
        execute 'revoke delete on table event_virtual_recording from upskill_worker';
      end if;
    end
    $$`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop trigger event_virtual_recording_guard_trg
    on event_virtual_recording`.execute(db);
  await sql`drop function guard_event_virtual_recording_evidence()`.execute(db);
  await sql`drop table event_virtual_recording`.execute(db);
  await sql`alter table event_virtual_room
    drop constraint event_virtual_room_recording_scope_uq`.execute(db);
}
