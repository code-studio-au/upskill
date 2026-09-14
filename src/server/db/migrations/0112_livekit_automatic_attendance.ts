import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_connection_interval
    drop constraint event_virtual_connection_interval_timeline_ck,
    alter column "joinedReceiptId" drop not null,
    add column "joinedSource" text not null default 'webhook',
    add column "leftSource" text`.execute(db);

  await sql`create or replace function guard_event_virtual_connection_interval()
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
        if row(
          new.id, new."roomId", new."eventVirtualJoinAccessId",
          new."eventOccurrenceId", new."eventSessionId", new."roomGeneration",
          new."lobbyEntryId", new."eventParticipationId",
          new."providerParticipantSid", new."participantIdentityDigest",
          new."createdAt"
        ) is distinct from row(
          old.id, old."roomId", old."eventVirtualJoinAccessId",
          old."eventOccurrenceId", old."eventSessionId", old."roomGeneration",
          old."lobbyEntryId", old."eventParticipationId",
          old."providerParticipantSid", old."participantIdentityDigest",
          old."createdAt"
        ) then
          raise exception 'Connection interval identity is immutable'
            using errcode = '23514';
        end if;
        if old."leftAt" is not null and row(
          new."leftAt", new."leftReceiptId", new."leftSource"
        ) is distinct from row(
          old."leftAt", old."leftReceiptId", old."leftSource"
        ) and not (
          old."leftSource" is null
          and new."leftSource" = 'webhook'
          and row(new."leftAt", new."leftReceiptId") is not distinct from row(
            old."leftAt", old."leftReceiptId"
          )
        ) and not (
          old."leftSource" in ('provider_reconciliation', 'room_end')
          and new."leftSource" = 'webhook'
          and new."leftReceiptId" is not null
          and new."leftAt" >= new."joinedAt"
          and new."leftAt" <= old."leftAt"
        ) then
          raise exception 'Closed connection evidence is immutable'
            using errcode = '23514';
        end if;
        if old."joinedSource" = 'webhook' and row(
          new."joinedAt", new."joinedReceiptId", new."joinedSource"
        ) is distinct from row(
          old."joinedAt", old."joinedReceiptId", old."joinedSource"
        ) then
          raise exception 'Webhook join evidence is immutable'
            using errcode = '23514';
        end if;
        if old."joinedSource" = 'provider_reconciliation' and row(
          new."joinedAt", new."joinedReceiptId", new."joinedSource"
        ) is distinct from row(
          old."joinedAt", old."joinedReceiptId", old."joinedSource"
        ) and not (
          new."joinedSource" = 'webhook'
          and new."joinedReceiptId" is not null
          and new."joinedAt" <= old."joinedAt"
          and (old."leftAt" is null or new."joinedAt" <= old."leftAt")
        ) then
          raise exception 'Reconciled join evidence may only be upgraded by an earlier webhook'
            using errcode = '23514';
        end if;
      end if;
      if new."joinedSource" = 'webhook' and not exists (
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
      if new."leftSource" = 'webhook' and not exists (
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

  await sql`update event_virtual_connection_interval
    set "leftSource" = 'webhook'
    where "leftReceiptId" is not null`.execute(db);
  await sql`alter table event_virtual_connection_interval
    add constraint event_virtual_connection_interval_source_ck check (
      (
        "joinedSource" = 'webhook'
        and "joinedReceiptId" is not null
      )
      or (
        "joinedSource" = 'provider_reconciliation'
        and "joinedReceiptId" is null
      )
    ),
    add constraint event_virtual_connection_interval_timeline_ck check (
      "updatedAt" >= "createdAt"
      and (
        (
          "leftAt" is null
          and "leftReceiptId" is null
          and "leftSource" is null
        )
        or (
          "leftAt" is not null
          and (
            (
              "leftSource" = 'webhook'
              and "leftReceiptId" is not null
            )
            or (
              "leftSource" in ('provider_reconciliation', 'room_end')
              and "leftReceiptId" is null
            )
          )
        )
      )
      and ("leftAt" is null or "leftAt" >= "joinedAt")
    )`.execute(db);

  await sql`create table event_virtual_attendance_reconciliation (
    "roomId" text primary key
      references event_virtual_room(id) on delete restrict,
    status text not null,
    "evidenceRevision" integer not null default 0,
    "reconciledRevision" integer not null default 0,
    attempts integer not null default 0,
    "availableAt" timestamptz not null,
    "leasedUntil" timestamptz,
    "lastAttemptAt" timestamptz,
    "lastSuccessAt" timestamptz,
    "completedAt" timestamptz,
    "lastErrorCode" text,
    "createdAt" timestamptz not null,
    "updatedAt" timestamptz not null,
    constraint event_virtual_attendance_reconciliation_state_ck check (
      "evidenceRevision" >= 0
      and "reconciledRevision" >= 0
      and "reconciledRevision" <= "evidenceRevision"
      and attempts >= 0
      and (
        (
          status = 'pending'
          and "leasedUntil" is null
          and "completedAt" is null
        )
        or (
          status = 'processing'
          and "leasedUntil" is not null
          and "completedAt" is null
        )
        or (
          status = 'succeeded'
          and "leasedUntil" is null
          and "completedAt" is not null
          and "reconciledRevision" = "evidenceRevision"
        )
      )
    )
  )`.execute(db);
  await sql`create index event_virtual_attendance_reconciliation_pending_idx
    on event_virtual_attendance_reconciliation ("availableAt", "createdAt")
    where status = 'pending'`.execute(db);
  await sql`create index event_virtual_attendance_reconciliation_lease_idx
    on event_virtual_attendance_reconciliation ("leasedUntil")
    where status = 'processing'`.execute(db);

  await sql`create table event_virtual_attendance_decision (
    id text primary key,
    "roomId" text not null,
    "eventVirtualJoinAccessId" text not null,
    "eventOccurrenceId" text not null,
    "eventSessionId" text not null,
    "roomGeneration" integer not null,
    "lobbyEntryId" text not null,
    "eventParticipationId" text not null,
    "attendanceState" text not null,
    "attendanceMode" text not null,
    "attendanceMinimumMinutes" integer,
    "qualifyingConnectedSeconds" integer not null,
    "calculationVersion" integer not null,
    "decisionAt" timestamptz not null,
    "applicationOutcome" text not null,
    "previousAttendanceState" text,
    "previousAttendanceSource" text,
    constraint event_virtual_attendance_decision_uq unique (
      "roomId", "eventParticipationId", "attendanceState",
      "calculationVersion"
    ),
    constraint event_virtual_attendance_decision_room_fk foreign key (
      "roomId", "eventSessionId", "roomGeneration"
    ) references event_virtual_room (
      id, "eventSessionId", generation
    ) on delete restrict,
    constraint event_virtual_attendance_decision_lobby_fk foreign key (
      "lobbyEntryId", "eventVirtualJoinAccessId", "eventOccurrenceId",
      "eventSessionId", "roomGeneration", "eventParticipationId"
    ) references event_virtual_lobby_entry (
      id, "eventVirtualJoinAccessId", "eventOccurrenceId",
      "eventSessionId", "roomGeneration", "eventParticipationId"
    ) on delete restrict,
    constraint event_virtual_attendance_decision_policy_ck check (
      (
        "attendanceMode" = 'automatic_check_in'
        and "attendanceState" = 'checked_in'
        and "attendanceMinimumMinutes" is null
      )
      or (
        "attendanceMode" = 'automatic_duration'
        and "attendanceState" in ('checked_in', 'attended')
        and "attendanceMinimumMinutes" between 1 and 10080
      )
    ),
    constraint event_virtual_attendance_decision_evidence_ck check (
      "qualifyingConnectedSeconds" >= 0
      and "calculationVersion" > 0
      and "applicationOutcome" in (
        'applied', 'already_satisfied', 'preserved_manual'
      )
      and (
        ("previousAttendanceState" is null and "previousAttendanceSource" is null)
        or (
          "previousAttendanceState" in (
            'not_recorded', 'checked_in', 'attended', 'absent'
          )
          and "previousAttendanceSource" in (
            'system', 'self_check_in', 'coordinator', 'presenter',
            'administrator'
          )
        )
      )
    )
  )`.execute(db);
  await sql`create index event_virtual_attendance_decision_participation_idx
    on event_virtual_attendance_decision (
      "eventParticipationId", "eventSessionId", "decisionAt", id
    )`.execute(db);

  await sql`create function guard_event_virtual_attendance_decision()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'DELETE' then
        if current_user in ('upskill_web', 'upskill_worker') then
          raise exception 'Automatic attendance decisions cannot be deleted'
            using errcode = '42501';
        end if;
        return old;
      end if;
      raise exception 'Automatic attendance decisions are immutable'
        using errcode = '23514';
    end
    $$`.execute(db);
  await sql`create trigger event_virtual_attendance_decision_guard_trg
    before update or delete on event_virtual_attendance_decision
    for each row execute function guard_event_virtual_attendance_decision()`.execute(
    db,
  );

  await sql`do $$
    begin
      if exists (select 1 from pg_roles where rolname = 'upskill_web') then
        execute 'revoke update, delete on table event_virtual_attendance_decision from upskill_web';
      end if;
      if exists (select 1 from pg_roles where rolname = 'upskill_worker') then
        execute 'revoke update, delete on table event_virtual_attendance_decision from upskill_worker';
      end if;
    end
    $$`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop trigger event_virtual_attendance_decision_guard_trg
    on event_virtual_attendance_decision`.execute(db);
  await sql`drop function guard_event_virtual_attendance_decision()`.execute(
    db,
  );
  await sql`drop table event_virtual_attendance_decision`.execute(db);
  await sql`drop table event_virtual_attendance_reconciliation`.execute(db);

  await sql`delete from event_virtual_connection_interval
    where "joinedReceiptId" is null or "leftSource" in (
      'provider_reconciliation', 'room_end'
    )`.execute(db);
  await sql`alter table event_virtual_connection_interval
    drop constraint event_virtual_connection_interval_timeline_ck,
    drop constraint event_virtual_connection_interval_source_ck,
    drop column "leftSource",
    drop column "joinedSource",
    alter column "joinedReceiptId" set not null,
    add constraint event_virtual_connection_interval_timeline_ck check (
      "updatedAt" >= "createdAt"
      and ("leftAt" is null) = ("leftReceiptId" is null)
      and ("leftAt" is null or "leftAt" >= "joinedAt")
    )`.execute(db);

  await sql`create or replace function guard_event_virtual_connection_interval()
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
}
