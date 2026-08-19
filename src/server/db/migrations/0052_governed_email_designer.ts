import { sql, type Kysely } from "kysely";

const previousAuditActions = sql.raw(`
  'course.archived', 'course.created', 'course.deleted', 'course.published', 'course.version_created',
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
`);

const nextAuditActions = sql.raw(`
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
  await sql`create table email_design (
    id text primary key,
    catalogue text not null,
    name text not null,
    "contextKey" text not null,
    "systemKey" text unique,
    "activeVersionId" text,
    "createdByUserId" text references "user"(id) on delete set null,
    "createdAt" timestamptz not null default now(),
    "updatedAt" timestamptz not null default now(),
    constraint email_design_catalogue_ck check (catalogue in ('offering', 'system')),
    constraint email_design_name_ck check (char_length(btrim(name)) between 2 and 120),
    constraint email_design_context_ck check ("contextKey" in ('system_account_setup', 'offering_course', 'offering_event')),
    constraint email_design_system_identity_ck check (
      (catalogue = 'system' and "systemKey" is not null and "contextKey" = 'system_account_setup')
      or (catalogue = 'offering' and "systemKey" is null and "contextKey" in ('offering_course', 'offering_event'))
    )
  )`.execute(db);

  await sql`create table email_design_version (
    id text primary key,
    "emailDesignId" text not null references email_design(id) on delete restrict,
    version integer not null,
    "contractKey" text not null,
    "contractVersion" integer not null,
    subject text not null,
    "textBody" text not null,
    "referencedVariables" jsonb not null default '[]'::jsonb,
    "createdByUserId" text references "user"(id) on delete set null,
    "publishedByUserId" text references "user"(id) on delete set null,
    "publishedAt" timestamptz,
    "createdAt" timestamptz not null default now(),
    constraint email_design_version_number_ck check (version > 0),
    constraint email_design_version_contract_ck check ("contractVersion" > 0),
    constraint email_design_version_subject_ck check (char_length(btrim(subject)) between 1 and 180 and subject !~ E'[\\r\\n]'),
    constraint email_design_version_body_ck check (char_length(btrim("textBody")) between 1 and 20000),
    constraint email_design_version_variables_ck check (jsonb_typeof("referencedVariables") = 'array'),
    constraint email_design_version_publication_ck check (
      "publishedAt" is not null or "publishedByUserId" is null
    ),
    unique ("emailDesignId", version),
    unique (id, "emailDesignId")
  )`.execute(db);
  await sql`create unique index email_design_version_one_draft_uq
    on email_design_version ("emailDesignId") where "publishedAt" is null`.execute(
    db,
  );
  await sql`create index email_design_catalogue_name_idx
    on email_design (catalogue, name, id)`.execute(db);
  await sql`alter table email_design add constraint email_design_active_version_fk
    foreign key ("activeVersionId", id)
    references email_design_version(id, "emailDesignId") on delete restrict`.execute(
    db,
  );

  await sql`create function enforce_email_design_active_publication()
    returns trigger language plpgsql as $$
    begin
      if new."activeVersionId" is not null and not exists (
        select 1 from email_design_version version
        where version.id = new."activeVersionId"
          and version."emailDesignId" = new.id
          and version."publishedAt" is not null
      ) then
        raise exception 'Active email design version must be published';
      end if;
      return new;
    end;
    $$`.execute(db);
  await sql`create trigger email_design_active_publication_trg
    before insert or update of "activeVersionId" on email_design
    for each row execute function enforce_email_design_active_publication()`.execute(
    db,
  );
  await sql`create function protect_published_email_design_version()
    returns trigger language plpgsql as $$
    begin
      if old."publishedAt" is not null then
        raise exception 'Published email design versions are immutable';
      end if;
      return case when tg_op = 'DELETE' then old else new end;
    end;
    $$`.execute(db);
  await sql`create trigger email_design_version_immutable_trg
    before update or delete on email_design_version
    for each row execute function protect_published_email_design_version()`.execute(
    db,
  );

  await sql`insert into email_design (
    id, catalogue, name, "contextKey", "systemKey", "createdAt", "updatedAt"
  ) values (
    'email_design_system_account_setup',
    'system',
    'Account setup',
    'system_account_setup',
    'account_setup_requested',
    now(),
    now()
  )`.execute(db);
  await sql`insert into email_design_version (
    id, "emailDesignId", version, "contractKey", "contractVersion",
    subject, "textBody", "referencedVariables", "publishedAt", "createdAt"
  ) values (
    'email_design_version_system_account_setup_v1',
    'email_design_system_account_setup',
    1,
    'system.account_setup_requested',
    1,
    'Set up your Upskill account',
    E'Hello {{user.fullName}},\\n\\nAn Upskill account has been created for you. Set your password within 72 hours:\\n\\n{{account.setupUrl}}\\n\\nIf you were not expecting this message, you can ignore it.',
    '["account.setupUrl", "user.fullName"]'::jsonb,
    now(),
    now()
  )`.execute(db);
  await sql`update email_design
    set "activeVersionId" = 'email_design_version_system_account_setup_v1'
    where id = 'email_design_system_account_setup'`.execute(db);

  await sql`alter table notification
    add column "emailDesignVersionId" text references email_design_version(id) on delete restrict,
    add column "renderedSubject" text,
    add column "renderedTextBody" text,
    add column "renderedHtmlBody" text,
    add column "renderedAt" timestamptz`.execute(db);
  await sql`update notification
    set "emailDesignVersionId" = 'email_design_version_system_account_setup_v1'`.execute(
    db,
  );
  await sql`update notification notification
    set "renderedSubject" = capture.subject,
        "renderedTextBody" = capture."textBody",
        "renderedHtmlBody" = capture."textBody",
        "renderedAt" = capture."createdAt"
    from email_delivery_capture capture
    where capture."notificationId" = notification.id`.execute(db);
  await sql`alter table notification
    alter column "emailDesignVersionId" set not null,
    add constraint notification_render_snapshot_ck check (
      ("renderedAt" is null and "renderedSubject" is null and "renderedTextBody" is null and "renderedHtmlBody" is null)
      or ("renderedAt" is not null and "renderedSubject" is not null and "renderedTextBody" is not null and "renderedHtmlBody" is not null)
    )`.execute(db);
  await sql`alter table email_delivery_capture add column "htmlBody" text`.execute(
    db,
  );

  await replaceAuditActions(db, nextAuditActions);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await replaceAuditActions(db, previousAuditActions);
  await sql`alter table email_delivery_capture drop column "htmlBody"`.execute(
    db,
  );
  await sql`alter table notification
    drop constraint notification_render_snapshot_ck,
    drop column "renderedAt",
    drop column "renderedHtmlBody",
    drop column "renderedTextBody",
    drop column "renderedSubject",
    drop column "emailDesignVersionId"`.execute(db);
  await sql`drop trigger email_design_version_immutable_trg on email_design_version`.execute(
    db,
  );
  await sql`drop function protect_published_email_design_version()`.execute(db);
  await sql`drop trigger email_design_active_publication_trg on email_design`.execute(
    db,
  );
  await sql`drop function enforce_email_design_active_publication()`.execute(
    db,
  );
  await sql`alter table email_design drop constraint email_design_active_version_fk`.execute(
    db,
  );
  await sql`drop table email_design_version`.execute(db);
  await sql`drop table email_design`.execute(db);
}
