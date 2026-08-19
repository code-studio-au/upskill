import { sql, type Kysely } from "kysely";

const baseAuditActionSql = `
  'course.archived', 'course.created', 'course.deleted', 'course.published', 'course.version_created',
  'email_design.created', 'email_design.draft_created', 'email_design.draft_deleted',
  'email_design.published', 'email_design.rolled_back',
  'enrollment.access_code_redeemed', 'enrollment.administrator_added', 'enrollment.administrator_removed',
  'enrollment.learning_completed', 'enrollment.purchased', 'enrollment.scorm_completed',
  'learning.progress_overridden', 'order.checkout_failed', 'order.checkout_paid', 'order.paid_existing_enrollment',
  'order.refund_recorded',
  'resource.uploaded', 'resource.version_removed', 'scorm.attempt_launch_issued', 'scorm.package_ready',
  'scorm.package_rejected', 'scorm.package_uploaded', 'scorm.package_version_removed',
  'survey.created', 'survey.published', 'survey.version_created',
  'access_grant.administrator_created', 'access_grant.administrator_revoked',
  'access_grant.administrator_capacity_updated', 'access_grant.administrator_code_revealed',
  'event_occurrence.created', 'event_occurrence.published', 'event_occurrence.updated',
  'event_occurrence.lifecycle_changed', 'event_occurrence.rescheduled', 'event_attendance.recorded',
  'event_occurrence.guest_access_rotated',
  'event_registration.submitted', 'event_registration.administrator_added',
  'event_registration.coordinator_reviewed', 'event_registration.final_decided',
  'event_registration.withdrawn', 'event_registration.region_reassigned',
  'event_registration.region_mismatch_acknowledged', 'event_registration.region_decided',
  'event_region_review.locked',
  'event_template.created', 'event_template.draft_deleted', 'event_template.version_created',
  'event_template.version_published', 'event_staff.eligibility_granted', 'event_staff.eligibility_revoked',
  'coordination_region.created', 'coordination_region.updated',
  'coordination_region.retired', 'coordination_region.reactivated',
  'user.provisional_created', 'user.account_activated', 'user.account_setup_resent',
  'user.onboarding_reassigned', 'user.region_updated',
  'access_grant.owner_assigned', 'access_grant.owner_activated',
  'access_grant.owner_revoked', 'access_grant.owner_code_revealed',
  'entitlement.information_release_accepted'
`;

const nextAuditActions = sql.raw(`
  ${baseAuditActionSql},
  'communication_plan.created', 'communication_plan.updated', 'communication_plan.deleted',
  'communication_plan.overridden', 'communication_plan.reset'
`);

async function replaceAuditActions(
  db: Kysely<unknown>,
  actions: ReturnType<typeof sql.raw>,
): Promise<void> {
  await sql`alter table audit_event drop constraint audit_event_action_known_ck`.execute(
    db,
  );
  await sql`alter table audit_event add constraint audit_event_action_known_ck check (action in (${actions}))`.execute(
    db,
  );
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table course_version_communication (
    id text primary key,
    "courseVersionId" text not null references course_version(id) on delete cascade,
    "sectionId" text references course_version_section(id) on delete set null,
    position integer not null,
    label text not null,
    "emailDesignVersionId" text not null references email_design_version(id) on delete restrict,
    audience text not null,
    trigger text not null,
    "offsetAmount" integer not null default 0,
    "offsetUnit" text not null default 'minute',
    "subjectOverride" text,
    "textBodyOverride" text,
    "createdByUserId" text references "user"(id) on delete set null,
    "createdAt" timestamptz not null default now(),
    "updatedAt" timestamptz not null default now(),
    constraint course_version_communication_position_ck check (position >= 0),
    constraint course_version_communication_label_ck check (char_length(btrim(label)) between 2 and 120),
    constraint course_version_communication_audience_ck check (audience in ('affected_learner', 'active_enrollees')),
    constraint course_version_communication_trigger_ck check (trigger in ('enrollment_created', 'enrollment_completed', 'course_incomplete', 'enrollment_expiring')),
    constraint course_version_communication_offset_ck check ("offsetAmount" between -10000 and 10000 and "offsetUnit" in ('minute', 'hour', 'day', 'week')),
    constraint course_version_communication_subject_ck check ("subjectOverride" is null or (char_length(btrim("subjectOverride")) between 1 and 180 and "subjectOverride" !~ E'[\\r\\n]')),
    constraint course_version_communication_body_ck check ("textBodyOverride" is null or char_length(btrim("textBodyOverride")) between 1 and 20000)
  )`.execute(db);
  await sql`create unique index course_version_communication_position_uq
    on course_version_communication ("courseVersionId", position)`.execute(db);
  await sql`create function protect_course_version_communication()
    returns trigger language plpgsql as $$
    declare parent_id text;
    begin
      if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
        return old;
      end if;
      parent_id := case when tg_op = 'DELETE' then old."courseVersionId" else new."courseVersionId" end;
      if exists (
        select 1 from course_version where id = parent_id and "publishedAt" is not null
      ) then
        raise exception 'Published course communication plans are immutable';
      end if;
      return case when tg_op = 'DELETE' then old else new end;
    end;
    $$`.execute(db);
  await sql`create trigger course_version_communication_immutable_trg
    before insert or update or delete on course_version_communication
    for each row execute function protect_course_version_communication()`.execute(
    db,
  );

  await sql`create table event_template_version_communication (
    id text primary key,
    "eventTemplateVersionId" text not null references event_template_version(id) on delete cascade,
    "sectionId" text references event_template_version_section(id) on delete set null,
    "sessionDefinitionId" text references event_template_session_definition(id) on delete set null,
    position integer not null,
    label text not null,
    "emailDesignVersionId" text not null references email_design_version(id) on delete restrict,
    audience text not null,
    trigger text not null,
    "offsetAmount" integer not null default 0,
    "offsetUnit" text not null default 'minute',
    "subjectOverride" text,
    "textBodyOverride" text,
    "createdByUserId" text references "user"(id) on delete set null,
    "createdAt" timestamptz not null default now(),
    "updatedAt" timestamptz not null default now(),
    constraint event_template_communication_position_ck check (position >= 0),
    constraint event_template_communication_label_ck check (char_length(btrim(label)) between 2 and 120),
    constraint event_template_communication_audience_ck check (audience in ('affected_learner', 'confirmed_participants', 'presenters', 'coordinators', 'administrators')),
    constraint event_template_communication_trigger_ck check (trigger in ('registration_submitted', 'registration_selected', 'event_start', 'event_end', 'session_start', 'section_release', 'event_completed')),
    constraint event_template_communication_offset_ck check ("offsetAmount" between -10000 and 10000 and "offsetUnit" in ('minute', 'hour', 'day', 'week')),
    constraint event_template_communication_subject_ck check ("subjectOverride" is null or (char_length(btrim("subjectOverride")) between 1 and 180 and "subjectOverride" !~ E'[\\r\\n]')),
    constraint event_template_communication_body_ck check ("textBodyOverride" is null or char_length(btrim("textBodyOverride")) between 1 and 20000)
  )`.execute(db);
  await sql`create unique index event_template_communication_position_uq
    on event_template_version_communication ("eventTemplateVersionId", position)`.execute(
    db,
  );
  await sql`create function protect_event_template_version_communication()
    returns trigger language plpgsql as $$
    declare parent_id text;
    begin
      if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
        return old;
      end if;
      parent_id := case when tg_op = 'DELETE' then old."eventTemplateVersionId" else new."eventTemplateVersionId" end;
      if exists (
        select 1 from event_template_version where id = parent_id and "publishedAt" is not null
      ) then
        raise exception 'Published event template communication plans are immutable';
      end if;
      return case when tg_op = 'DELETE' then old else new end;
    end;
    $$`.execute(db);
  await sql`create trigger event_template_communication_immutable_trg
    before insert or update or delete on event_template_version_communication
    for each row execute function protect_event_template_version_communication()`.execute(
    db,
  );

  await sql`create table event_occurrence_communication_revision (
    id text primary key,
    "logicalId" text not null,
    "eventOccurrenceId" text not null references event_occurrence(id) on delete cascade,
    "sourceTemplateCommunicationId" text not null references event_template_version_communication(id) on delete restrict,
    revision integer not null,
    active boolean not null default true,
    "overrideState" text not null,
    "emailDesignVersionId" text not null references email_design_version(id) on delete restrict,
    "sectionId" text references event_template_version_section(id) on delete set null,
    "sessionDefinitionId" text references event_template_session_definition(id) on delete set null,
    position integer not null,
    label text not null,
    audience text not null,
    trigger text not null,
    "offsetAmount" integer not null,
    "offsetUnit" text not null,
    subject text not null,
    "textBody" text not null,
    "createdByUserId" text references "user"(id) on delete set null,
    "createdAt" timestamptz not null default now(),
    constraint event_occurrence_communication_revision_number_ck check (revision > 0),
    constraint event_occurrence_communication_override_ck check ("overrideState" in ('inherited', 'overridden')),
    constraint event_occurrence_communication_position_ck check (position >= 0),
    constraint event_occurrence_communication_label_ck check (char_length(btrim(label)) between 2 and 120),
    constraint event_occurrence_communication_audience_ck check (audience in ('affected_learner', 'confirmed_participants', 'presenters', 'coordinators', 'administrators')),
    constraint event_occurrence_communication_trigger_ck check (trigger in ('registration_submitted', 'registration_selected', 'event_start', 'event_end', 'session_start', 'section_release', 'event_completed')),
    constraint event_occurrence_communication_offset_ck check ("offsetAmount" between -10000 and 10000 and "offsetUnit" in ('minute', 'hour', 'day', 'week')),
    constraint event_occurrence_communication_subject_ck check (char_length(btrim(subject)) between 1 and 180 and subject !~ E'[\\r\\n]'),
    constraint event_occurrence_communication_body_ck check (char_length(btrim("textBody")) between 1 and 20000),
    unique ("logicalId", revision)
  )`.execute(db);
  await sql`create unique index event_occurrence_communication_active_uq
    on event_occurrence_communication_revision ("logicalId") where active`.execute(
    db,
  );
  await sql`create index event_occurrence_communication_occurrence_idx
    on event_occurrence_communication_revision ("eventOccurrenceId", position, "logicalId") where active`.execute(
    db,
  );

  await sql`create function enforce_published_communication_email_version()
    returns trigger language plpgsql as $$
    begin
      if not exists (
        select 1 from email_design_version version
        where version.id = new."emailDesignVersionId" and version."publishedAt" is not null
      ) then
        raise exception 'Communication plans require a published email version';
      end if;
      return new;
    end;
    $$`.execute(db);
  for (const table of [
    "course_version_communication",
    "event_template_version_communication",
    "event_occurrence_communication_revision",
  ])
    await sql
      .raw(
        `create trigger ${table}_published_email_trg
      before insert or update of "emailDesignVersionId" on ${table}
      for each row execute function enforce_published_communication_email_version()`,
      )
      .execute(db);

  await replaceAuditActions(db, nextAuditActions);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Audit records are append-only, so the expanded action constraint must remain valid.
  for (const table of [
    "event_occurrence_communication_revision",
    "event_template_version_communication",
    "course_version_communication",
  ])
    await sql
      .raw(`drop trigger ${table}_published_email_trg on ${table}`)
      .execute(db);
  await sql`drop trigger event_template_communication_immutable_trg on event_template_version_communication`.execute(
    db,
  );
  await sql`drop function protect_event_template_version_communication()`.execute(
    db,
  );
  await sql`drop trigger course_version_communication_immutable_trg on course_version_communication`.execute(
    db,
  );
  await sql`drop function protect_course_version_communication()`.execute(db);
  await sql`drop function enforce_published_communication_email_version()`.execute(
    db,
  );
  await sql`drop table event_occurrence_communication_revision`.execute(db);
  await sql`drop table event_template_version_communication`.execute(db);
  await sql`drop table course_version_communication`.execute(db);
}
