import { sql, type Kysely } from "kysely";

const newAuditActions = [
  "event_virtual_recording.deletion_requested",
  "event_virtual_recording.deletion_retried",
  "event_virtual_recording.deleted",
] as const;

function values(items: ReadonlyArray<string>): string {
  return items.map((item) => `''${item}''`).join(", ");
}

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`create table event_virtual_recording_deletion (
    "recordingId" text primary key
      references event_virtual_recording(id) on delete restrict,
    reason text not null,
    "requestedByUserId" text references "user"(id) on delete restrict,
    status text not null default 'pending',
    attempts integer not null default 0,
    "availableAt" timestamptz not null,
    "leasedUntil" timestamptz,
    "lastAttemptAt" timestamptz,
    "completedAt" timestamptz,
    "lastErrorCode" text,
    "createdAt" timestamptz not null,
    "updatedAt" timestamptz not null,
    constraint event_virtual_recording_deletion_reason_ck check (
      reason in ('administrator_requested', 'retention_expired')
    ),
    constraint event_virtual_recording_deletion_actor_ck check (
      (reason = 'administrator_requested' and "requestedByUserId" is not null)
      or (reason = 'retention_expired' and "requestedByUserId" is null)
    ),
    constraint event_virtual_recording_deletion_status_ck check (
      status in ('pending', 'processing', 'failed', 'succeeded')
    ),
    constraint event_virtual_recording_deletion_attempt_ck check (
      attempts >= 0
      and ((attempts = 0) = ("lastAttemptAt" is null))
    ),
    constraint event_virtual_recording_deletion_error_ck check (
      "lastErrorCode" is null
      or "lastErrorCode" ~ '^[a-z0-9_]{1,100}$'
    ),
    constraint event_virtual_recording_deletion_timeline_ck check (
      "createdAt" <= "updatedAt"
      and "createdAt" <= "availableAt"
      and ("lastAttemptAt" is null or "lastAttemptAt" >= "createdAt")
      and ("leasedUntil" is null or "leasedUntil" > "lastAttemptAt")
      and ("completedAt" is null or "completedAt" >= "lastAttemptAt")
    ),
    constraint event_virtual_recording_deletion_state_ck check (
      (status = 'pending' and "leasedUntil" is null and "completedAt" is null)
      or (
        status = 'processing'
        and "leasedUntil" is not null
        and "lastAttemptAt" is not null
        and "completedAt" is null
        and "lastErrorCode" is null
      )
      or (
        status = 'failed'
        and "leasedUntil" is null
        and "lastAttemptAt" is not null
        and "completedAt" is null
        and "lastErrorCode" is not null
      )
      or (
        status = 'succeeded'
        and "leasedUntil" is null
        and "lastAttemptAt" is not null
        and "completedAt" is not null
        and "lastErrorCode" is null
      )
    )
  )`.execute(db);
  await sql`create index event_virtual_recording_deletion_work_idx
    on event_virtual_recording_deletion ("availableAt", "createdAt", "recordingId")
    where status in ('pending', 'processing', 'failed')`.execute(db);

  await sql`create function guard_event_virtual_recording_deletion()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'INSERT' then
        if new.status <> 'pending' or new.attempts <> 0 then
          raise exception 'Recording deletion must begin pending'
            using errcode = '23514';
        end if;
        return new;
      end if;

      if tg_op = 'DELETE' then
        if current_user in ('upskill_web', 'upskill_worker') then
          raise exception 'Recording deletion evidence cannot be removed'
            using errcode = '42501';
        end if;
        return old;
      end if;

      if row(
        new."recordingId", new.reason, new."requestedByUserId", new."createdAt"
      ) is distinct from row(
        old."recordingId", old.reason, old."requestedByUserId", old."createdAt"
      ) then
        raise exception 'Recording deletion request evidence is immutable'
          using errcode = '23514';
      end if;
      if new.attempts < old.attempts or new."updatedAt" < old."updatedAt" then
        raise exception 'Recording deletion progress cannot move backwards'
          using errcode = '23514';
      end if;
      if old.status = 'succeeded' and new is distinct from old then
        raise exception 'Completed recording deletion evidence is immutable'
          using errcode = '23514';
      end if;
      if new.status is distinct from old.status and not (
        (old.status = 'pending' and new.status = 'processing')
        or (old.status = 'processing' and new.status in ('processing', 'failed', 'succeeded'))
        or (old.status = 'failed' and new.status in ('pending', 'processing'))
      ) then
        raise exception 'Recording deletion transition is not allowed'
          using errcode = '23514';
      end if;
      return new;
    end
    $$`.execute(db);
  await sql`create trigger event_virtual_recording_deletion_guard_trg
    before insert or update or delete on event_virtual_recording_deletion
    for each row execute function guard_event_virtual_recording_deletion()`.execute(
    db,
  );

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

  await sql`do $$
    begin
      if exists (select 1 from pg_roles where rolname = 'upskill_web') then
        execute 'revoke delete on table event_virtual_recording_deletion from upskill_web';
      end if;
      if exists (select 1 from pg_roles where rolname = 'upskill_worker') then
        execute 'revoke delete on table event_virtual_recording_deletion from upskill_worker';
      end if;
    end
    $$`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  // Retained audit history may already use the expanded action set.
  await sql`drop trigger event_virtual_recording_deletion_guard_trg
    on event_virtual_recording_deletion`.execute(db);
  await sql`drop function guard_event_virtual_recording_deletion()`.execute(db);
  await sql`drop table event_virtual_recording_deletion`.execute(db);
}
