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
        or "retentionDeadline" >= "completedAt"
      )
      and (
        "deletedAt" is null
        or "deletedAt" >= "completedAt"
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
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop table event_virtual_recording`.execute(db);
  await sql`alter table event_virtual_room
    drop constraint event_virtual_room_recording_scope_uq`.execute(db);
}
