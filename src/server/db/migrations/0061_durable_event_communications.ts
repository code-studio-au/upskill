import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table notification
    drop constraint notification_template_ck,
    add column "subjectTemplateSnapshot" text,
    add column "textBodyTemplateSnapshot" text`.execute(db);
  await sql`update notification notification
    set "subjectTemplateSnapshot" = version.subject,
        "textBodyTemplateSnapshot" = version."textBody"
    from email_design_version version
    where version.id = notification."emailDesignVersionId"`.execute(db);
  await sql`alter table notification
    alter column "subjectTemplateSnapshot" set not null,
    alter column "textBodyTemplateSnapshot" set not null,
    add constraint notification_template_ck check ("templateKey" in ('account_setup_requested', 'offering_course', 'offering_event')),
    add constraint notification_subject_template_snapshot_ck check (
      char_length(btrim("subjectTemplateSnapshot")) between 1 and 180
      and "subjectTemplateSnapshot" !~ E'[\\r\\n]'
    ),
    add constraint notification_text_body_template_snapshot_ck check (
      char_length(btrim("textBodyTemplateSnapshot")) between 1 and 20000
    )`.execute(db);

  await sql`create table event_communication_schedule (
    id text primary key,
    "logicalId" text not null,
    revision integer not null,
    "eventOccurrenceId" text not null references event_occurrence(id) on delete cascade,
    "eventOccurrenceCommunicationRevisionId" text not null references event_occurrence_communication_revision(id) on delete restrict,
    trigger text not null,
    "dueAt" timestamptz not null,
    status text not null default 'pending',
    attempts integer not null default 0,
    "availableAt" timestamptz not null,
    "lastErrorCode" text,
    "recipientCount" integer,
    "processedAt" timestamptz,
    "supersededAt" timestamptz,
    "createdAt" timestamptz not null default now(),
    "updatedAt" timestamptz not null default now(),
    constraint event_communication_schedule_revision_ck check (revision > 0),
    constraint event_communication_schedule_trigger_ck check (trigger in ('event_start', 'event_end', 'session_start')),
    constraint event_communication_schedule_attempts_ck check (attempts >= 0),
    constraint event_communication_schedule_recipient_count_ck check ("recipientCount" is null or "recipientCount" >= 0),
    constraint event_communication_schedule_status_ck check (status in ('pending', 'processing', 'completed', 'failed', 'superseded')),
    constraint event_communication_schedule_state_ck check (
      (status in ('pending', 'processing') and "processedAt" is null and "supersededAt" is null and "recipientCount" is null)
      or (status = 'completed' and "processedAt" is not null and "supersededAt" is null and "recipientCount" is not null)
      or (status = 'failed' and "processedAt" is null and "supersededAt" is null and "recipientCount" is null and "lastErrorCode" is not null)
      or (status = 'superseded' and "processedAt" is null and "supersededAt" is not null and "recipientCount" is null)
    ),
    unique ("logicalId", revision)
  )`.execute(db);
  await sql`create unique index event_communication_schedule_active_uq
    on event_communication_schedule ("logicalId")
    where status in ('pending', 'processing')`.execute(db);
  await sql`create index event_communication_schedule_due_idx
    on event_communication_schedule ("availableAt", "dueAt", id)
    where status in ('pending', 'processing')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table event_communication_schedule`.execute(db);
  await sql`delete from outbox_event
    where topic = 'notification.delivery_requested'
      and "aggregateId" in (
        select id from notification where "templateKey" in ('offering_course', 'offering_event')
      )`.execute(db);
  await sql`delete from notification where "templateKey" in ('offering_course', 'offering_event')`.execute(
    db,
  );
  await sql`alter table notification
    drop constraint notification_text_body_template_snapshot_ck,
    drop constraint notification_subject_template_snapshot_ck,
    drop constraint notification_template_ck,
    add constraint notification_template_ck check ("templateKey" in ('account_setup_requested')),
    drop column "textBodyTemplateSnapshot",
    drop column "subjectTemplateSnapshot"`.execute(db);
}
