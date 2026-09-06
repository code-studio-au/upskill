import { sql, type Kysely } from "kysely";

const newAuditActions = [
  "event_virtual_join_access.created",
  "event_virtual_join_access.revoked",
  "event_virtual_lobby.requested",
  "event_virtual_lobby.admission_changed",
  "event_virtual_lobby.recovery_verified",
  "event_virtual_lobby.attendee_token_issued",
] as const;

function values(items: ReadonlyArray<string>): string {
  return items.map((item) => `''${item}''`).join(", ");
}

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_session
    add constraint event_session_id_occurrence_uq
    unique (id, "eventOccurrenceId")`.execute(db);
  await sql`alter table event_participation
    add constraint event_participation_id_occurrence_uq
    unique (id, "eventOccurrenceId")`.execute(db);

  await sql`create table event_virtual_join_access (
    id text primary key,
    "eventOccurrenceId" text not null,
    "eventSessionId" text not null,
    "roomGeneration" integer not null,
    "publicReference" text not null unique,
    "createdAt" timestamptz not null,
    "revokedAt" timestamptz,
    "revokedByUserId" text references "user"(id) on delete restrict,
    constraint event_virtual_join_access_scope_uq unique (
      id, "eventOccurrenceId", "eventSessionId", "roomGeneration"
    ),
    constraint event_virtual_join_access_generation_uq unique (
      "eventSessionId", "roomGeneration"
    ),
    constraint event_virtual_join_access_session_fk foreign key (
      "eventSessionId", "eventOccurrenceId"
    ) references event_session (id, "eventOccurrenceId") on delete restrict,
    constraint event_virtual_join_access_reference_ck check (
      "publicReference" ~ '^[A-Za-z0-9_-]{43}$'
    ),
    constraint event_virtual_join_access_generation_ck check (
      "roomGeneration" >= 1
    ),
    constraint event_virtual_join_access_revocation_ck check (
      ("revokedAt" is null) = ("revokedByUserId" is null)
      and ("revokedAt" is null or "revokedAt" >= "createdAt")
    )
  )`.execute(db);
  await sql`create unique index event_virtual_join_access_current_uq
    on event_virtual_join_access ("eventSessionId")
    where "revokedAt" is null`.execute(db);

  await sql`create table event_virtual_lobby_entry (
    id text primary key,
    "eventVirtualJoinAccessId" text not null,
    "eventOccurrenceId" text not null,
    "eventSessionId" text not null,
    "roomGeneration" integer not null,
    "eventParticipationId" text not null,
    state text not null,
    "accessMethod" text not null,
    "requestedAt" timestamptz not null,
    "admittedAt" timestamptz,
    "admittedByUserId" text references "user"(id) on delete restrict,
    "declinedAt" timestamptz,
    "declinedByUserId" text references "user"(id) on delete restrict,
    "revokedAt" timestamptz,
    "revokedByUserId" text references "user"(id) on delete restrict,
    "firstTokenIssuedAt" timestamptz,
    "recordingAcknowledgedAt" timestamptz,
    "recordingNoticeDigest" text,
    "firstConnectedAt" timestamptz,
    "lastSeenAt" timestamptz,
    "leftAt" timestamptz,
    "updatedAt" timestamptz not null,
    constraint event_virtual_lobby_entry_access_fk foreign key (
      "eventVirtualJoinAccessId", "eventOccurrenceId", "eventSessionId", "roomGeneration"
    ) references event_virtual_join_access (
      id, "eventOccurrenceId", "eventSessionId", "roomGeneration"
    ) on delete restrict,
    constraint event_virtual_lobby_entry_participation_fk foreign key (
      "eventParticipationId", "eventOccurrenceId"
    ) references event_participation (id, "eventOccurrenceId") on delete restrict,
    constraint event_virtual_lobby_entry_identity_uq unique (
      "eventVirtualJoinAccessId", "eventParticipationId"
    ),
    constraint event_virtual_lobby_entry_state_ck check (
      state in (
        'waiting', 'admitted', 'token_issued', 'connected', 'left',
        'declined', 'revoked'
      )
      and (state not in ('admitted', 'token_issued', 'connected', 'left')
        or "admittedAt" is not null)
      and (state not in ('token_issued', 'connected', 'left')
        or "firstTokenIssuedAt" is not null)
      and (state <> 'declined' or "declinedAt" is not null)
      and (state <> 'revoked' or "revokedAt" is not null)
    ),
    constraint event_virtual_lobby_entry_access_method_ck check (
      "accessMethod" in ('authenticated', 'email', 'sms')
    ),
    constraint event_virtual_lobby_entry_actor_time_ck check (
      ("admittedByUserId" is null or "admittedAt" is not null)
      and ("declinedByUserId" is null or "declinedAt" is not null)
      and ("revokedByUserId" is null or "revokedAt" is not null)
    ),
    constraint event_virtual_lobby_entry_recording_ck check (
      ("recordingAcknowledgedAt" is null) = ("recordingNoticeDigest" is null)
      and ("recordingNoticeDigest" is null
        or "recordingNoticeDigest" ~ '^[A-Za-z0-9_-]{43}$')
    ),
    constraint event_virtual_lobby_entry_timeline_ck check (
      "updatedAt" >= "requestedAt"
      and ("admittedAt" is null or "admittedAt" >= "requestedAt")
      and ("declinedAt" is null or "declinedAt" >= "requestedAt")
      and ("revokedAt" is null or "revokedAt" >= "requestedAt")
      and ("firstTokenIssuedAt" is null
        or "firstTokenIssuedAt" >= "requestedAt")
    )
  )`.execute(db);
  await sql`create index event_virtual_lobby_entry_queue_idx
    on event_virtual_lobby_entry (
      "eventSessionId", "roomGeneration", state, "requestedAt"
    )`.execute(db);

  await sql`create table event_virtual_recovery_challenge (
    id text primary key,
    reference text not null unique,
    "eventVirtualJoinAccessId" text not null,
    "eventOccurrenceId" text not null,
    "eventSessionId" text not null,
    "roomGeneration" integer not null,
    "eventParticipationId" text not null,
    "userId" text not null references "user"(id) on delete restrict,
    channel text not null,
    "identifierDigest" text not null,
    "requestFingerprint" text not null,
    "codeDigest" text not null,
    attempts integer not null default 0,
    "resendCount" integer not null default 0,
    "deliveryStatus" text not null,
    "expiresAt" timestamptz not null,
    "consumedAt" timestamptz,
    "createdAt" timestamptz not null,
    constraint event_virtual_recovery_access_fk foreign key (
      "eventVirtualJoinAccessId", "eventOccurrenceId", "eventSessionId", "roomGeneration"
    ) references event_virtual_join_access (
      id, "eventOccurrenceId", "eventSessionId", "roomGeneration"
    ) on delete restrict,
    constraint event_virtual_recovery_participation_fk foreign key (
      "eventParticipationId", "eventOccurrenceId"
    ) references event_participation (id, "eventOccurrenceId") on delete restrict,
    constraint event_virtual_recovery_reference_ck check (
      reference ~ '^[A-Za-z0-9_-]{32}$'
    ),
    constraint event_virtual_recovery_digest_ck check (
      "identifierDigest" ~ '^[A-Za-z0-9_-]{43}$'
      and "requestFingerprint" ~ '^[A-Za-z0-9_-]{43}$'
      and "codeDigest" ~ '^[A-Za-z0-9_-]{43}$'
    ),
    constraint event_virtual_recovery_channel_ck check (
      channel in ('email', 'sms')
    ),
    constraint event_virtual_recovery_attempts_ck check (
      attempts between 0 and 5 and "resendCount" between 0 and 5
    ),
    constraint event_virtual_recovery_delivery_ck check (
      "deliveryStatus" in ('pending', 'sent', 'failed', 'unknown')
    ),
    constraint event_virtual_recovery_timeline_ck check (
      "expiresAt" > "createdAt"
      and ("consumedAt" is null or "consumedAt" >= "createdAt")
    )
  )`.execute(db);
  await sql`create index event_virtual_recovery_rate_idx
    on event_virtual_recovery_challenge (
      "eventVirtualJoinAccessId", "identifierDigest", "requestFingerprint", "createdAt" desc
    )`.execute(db);

  await sql`create table event_virtual_join_session (
    id text primary key,
    "challengeId" text not null unique
      references event_virtual_recovery_challenge(id) on delete restrict,
    "tokenDigest" text not null unique,
    "eventVirtualJoinAccessId" text not null,
    "eventOccurrenceId" text not null,
    "eventSessionId" text not null,
    "roomGeneration" integer not null,
    "eventParticipationId" text not null,
    "userId" text not null references "user"(id) on delete restrict,
    "accessMethod" text not null,
    "expiresAt" timestamptz not null,
    "lastUsedAt" timestamptz not null,
    "revokedAt" timestamptz,
    "createdAt" timestamptz not null,
    constraint event_virtual_join_session_access_fk foreign key (
      "eventVirtualJoinAccessId", "eventOccurrenceId", "eventSessionId", "roomGeneration"
    ) references event_virtual_join_access (
      id, "eventOccurrenceId", "eventSessionId", "roomGeneration"
    ) on delete restrict,
    constraint event_virtual_join_session_participation_fk foreign key (
      "eventParticipationId", "eventOccurrenceId"
    ) references event_participation (id, "eventOccurrenceId") on delete restrict,
    constraint event_virtual_join_session_token_ck check (
      "tokenDigest" ~ '^[A-Za-z0-9_-]{43}$'
    ),
    constraint event_virtual_join_session_method_ck check (
      "accessMethod" in ('email', 'sms')
    ),
    constraint event_virtual_join_session_timeline_ck check (
      "expiresAt" > "createdAt"
      and "lastUsedAt" >= "createdAt"
      and ("revokedAt" is null or "revokedAt" >= "createdAt")
    )
  )`.execute(db);
  await sql`create index event_virtual_join_session_active_idx
    on event_virtual_join_session ("expiresAt", "lastUsedAt")
    where "revokedAt" is null`.execute(db);

  await sql`create table event_virtual_recovery_email_capture (
    "challengeId" text primary key
      references event_virtual_recovery_challenge(id) on delete cascade,
    "recipientEmail" text not null,
    subject text not null,
    "textBody" text not null,
    "htmlBody" text not null,
    "createdAt" timestamptz not null
  )`.execute(db);
  await sql`create table event_virtual_recovery_sms_capture (
    "challengeId" text primary key
      references event_virtual_recovery_challenge(id) on delete cascade,
    "recipientPhone" text not null,
    message text not null,
    "createdAt" timestamptz not null
  )`.execute(db);

  await sql`alter table sms_delivery
    drop constraint sms_delivery_purpose_ck`.execute(db);
  await sql`alter table sms_delivery
    add constraint sms_delivery_purpose_ck check (
      purpose in (
        'event_prerequisite_recovery',
        'event_virtual_recovery',
        'onboarding_contact_verification',
        'profile_contact_verification'
      )
    )`.execute(db);

  await sql`do $$
    declare current_definition text;
    declare current_expression text;
    begin
      select pg_get_constraintdef(oid)
        into current_definition
        from pg_constraint
        where conrelid = 'audit_event'::regclass
          and conname = 'audit_event_action_known_ck';
      current_expression := regexp_replace(
        current_definition,
        '^CHECK \\((.*)\\)$',
        '\\1'
      );
      execute 'alter table audit_event drop constraint audit_event_action_known_ck';
      execute 'alter table audit_event add constraint audit_event_action_known_ck check (('
        || current_expression
        || ') or action in (${sql.raw(values(newAuditActions))}))';
    end $$`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table sms_delivery
    drop constraint sms_delivery_purpose_ck`.execute(db);
  await sql`alter table sms_delivery
    add constraint sms_delivery_purpose_ck check (
      purpose in (
        'event_prerequisite_recovery',
        'onboarding_contact_verification',
        'profile_contact_verification'
      )
    )`.execute(db);
  await sql`drop table event_virtual_recovery_sms_capture`.execute(db);
  await sql`drop table event_virtual_recovery_email_capture`.execute(db);
  await sql`drop index event_virtual_join_session_active_idx`.execute(db);
  await sql`drop table event_virtual_join_session`.execute(db);
  await sql`drop index event_virtual_recovery_rate_idx`.execute(db);
  await sql`drop table event_virtual_recovery_challenge`.execute(db);
  await sql`drop index event_virtual_lobby_entry_queue_idx`.execute(db);
  await sql`drop table event_virtual_lobby_entry`.execute(db);
  await sql`drop index event_virtual_join_access_current_uq`.execute(db);
  await sql`drop table event_virtual_join_access`.execute(db);
  await sql`alter table event_participation
    drop constraint event_participation_id_occurrence_uq`.execute(db);
  await sql`alter table event_session
    drop constraint event_session_id_occurrence_uq`.execute(db);
  // Durable audit rows may already contain the new action values. Preserve the
  // expanded audit constraint so rollback does not invalidate retained history.
}
