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
      and "providerRoomName" ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$'
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
      "processedAt" is null or "processedAt" >= "receivedAt"
    )
  )`.execute(db);

  await sql`create index livekit_webhook_receipt_processing_idx
    on livekit_webhook_receipt (
      "processingState", "receivedAt", id
    )
    where "processingState" in ('pending', 'failed')`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop table livekit_webhook_receipt`.execute(db);
}
