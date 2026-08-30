import { sql, type Kysely } from "kysely";

const eventTriggers = [
  "registration_submitted",
  "registration_selected",
  "registration_waitlisted",
  "registration_not_selected",
  "registration_cancelled",
  "event_rescheduled",
  "event_cancelled",
  "prework_incomplete",
  "post_event_incomplete",
  "event_start",
  "event_end",
  "session_start",
  "section_release",
  "event_completed",
] as const;

const auditActions = [
  "access_grant.owner_activated",
  "access_grant.owner_assigned",
  "access_grant.owner_code_revealed",
  "access_grant.owner_revoked",
  "access_grant.administrator_capacity_updated",
  "access_grant.administrator_code_revealed",
  "access_grant.administrator_created",
  "access_grant.administrator_revoked",
  "authorization.platform_admin.bootstrapped",
  "authorization.platform_admin.granted",
  "authorization.platform_admin.invitation_cancelled",
  "authorization.platform_admin.invited",
  "authorization.platform_admin.revoked",
  "course.archived",
  "course.created",
  "course.deleted",
  "course.published",
  "course.version_created",
  "communication_plan.created",
  "communication_plan.deleted",
  "communication_plan.overridden",
  "communication_plan.reset",
  "communication_plan.updated",
  "email_design.created",
  "email_design.draft_created",
  "email_design.draft_deleted",
  "email_design.published",
  "email_design.reordered",
  "email_design.rolled_back",
  "enterprise_contract.activated",
  "enterprise_contract.bulk_enrollment_completed",
  "enterprise_contract.claimed",
  "enterprise_contract.code_rotated",
  "enterprise_contract.code_revealed",
  "enterprise_contract.created",
  "enterprise_contract.eligibility_replaced",
  "enterprise_contract.entitlement_issued",
  "enterprise_contract.event_registered",
  "enterprise_contract.owner_activated",
  "enterprise_contract.owner_assigned",
  "enterprise_contract.owner_revoked",
  "enterprise_contract.renewed",
  "enterprise_contract.report_exported",
  "enterprise_contract.resumed",
  "enterprise_contract.suspended",
  "enterprise_contract.terminated",
  "event_occurrence.created",
  "event_occurrence.guest_access_rotated",
  "event_occurrence.updated",
  "event_occurrence.published",
  "event_occurrence.lifecycle_changed",
  "event_occurrence.rescheduled",
  "event_participation.completed",
  "event_participation.completion_revoked",
  "event_staff.eligibility_granted",
  "event_staff.eligibility_revoked",
  "coordination_region.created",
  "coordination_region.updated",
  "coordination_region.retired",
  "coordination_region.reactivated",
  "event_attendance.recorded",
  "event_late_registration_invitation.accepted",
  "event_late_registration_invitation.created",
  "event_late_registration_invitation.revoked",
  "event_prerequisite.recovery_verified",
  "event_region_review.locked",
  "event_registration.administrator_added",
  "event_registration.coordinator_reviewed",
  "event_registration.final_decided",
  "event_registration.region_mismatch_acknowledged",
  "event_registration.region_decided",
  "event_registration.region_reassigned",
  "event_registration.submitted",
  "event_registration.withdrawn",
  "event_template.created",
  "event_template.draft_deleted",
  "event_template.version_created",
  "event_template.version_published",
  "enrollment.access_code_redeemed",
  "enrollment.administrator_added",
  "enrollment.administrator_removed",
  "enrollment.learning_completed",
  "enrollment.purchased",
  "enrollment.scorm_completed",
  "entitlement.information_release_accepted",
  "learning.progress_overridden",
  "notification.delivery_requeued",
  "order.checkout_failed",
  "order.checkout_paid",
  "order.paid_existing_enrollment",
  "order.refund_recorded",
  "resource.uploaded",
  "resource.version_removed",
  "scorm.attempt_launch_issued",
  "scorm.package_ready",
  "scorm.package_rejected",
  "scorm.package_uploaded",
  "scorm.package_version_removed",
  "survey.created",
  "survey.published",
  "survey.reordered",
  "survey.version_created",
  "user.phone_verification_transferred",
  "user.provisional_created",
  "user.account_activated",
  "user.account_setup_resent",
  "user.onboarding_reassigned",
  "user.region_updated",
] as const;

function values(items: ReadonlyArray<string>): string {
  return items.map((item) => `'${item}'`).join(", ");
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table event_late_registration_invitation (
    id text primary key,
    "eventOccurrenceId" text not null references event_occurrence(id) on delete cascade,
    "userId" text not null references "user"(id) on delete restrict,
    "eventOccurrenceRegionId" text references event_occurrence_region(id) on delete restrict,
    "recipientNameSnapshot" text not null,
    "recipientEmailSnapshot" text not null,
    "tokenDigest" text not null unique,
    "overrideDomainRestriction" boolean not null default false,
    "expiresAt" timestamptz not null,
    "createdByUserId" text not null references "user"(id) on delete restrict,
    "createdAt" timestamptz not null default now(),
    "acceptedAt" timestamptz,
    "acceptedRegistrationId" text references event_registration(id) on delete restrict,
    "revokedAt" timestamptz,
    "revokedByUserId" text references "user"(id) on delete restrict,
    constraint event_late_registration_invitation_token_ck check ("tokenDigest" ~ '^[A-Za-z0-9_-]{43}$'),
    constraint event_late_registration_invitation_expiry_ck check ("expiresAt" > "createdAt"),
    constraint event_late_registration_invitation_identity_ck check (
      char_length(btrim("recipientNameSnapshot")) between 1 and 200
      and char_length(btrim("recipientEmailSnapshot")) between 3 and 320
    ),
    constraint event_late_registration_invitation_state_ck check (
      not ("acceptedAt" is not null and "revokedAt" is not null)
      and (("acceptedAt" is null and "acceptedRegistrationId" is null)
        or ("acceptedAt" is not null and "acceptedRegistrationId" is not null))
      and (("revokedAt" is null and "revokedByUserId" is null)
        or ("revokedAt" is not null and "revokedByUserId" is not null))
    )
  )`.execute(db);
  await sql`create unique index event_late_registration_invitation_pending_uq
    on event_late_registration_invitation ("eventOccurrenceId", "userId")
    where "acceptedAt" is null and "revokedAt" is null`.execute(db);
  await sql`create index event_late_registration_invitation_occurrence_idx
    on event_late_registration_invitation ("eventOccurrenceId", "createdAt" desc, id)`.execute(
    db,
  );

  await sql`create table event_operational_communication_schedule (
    id text primary key,
    "logicalId" text not null,
    revision integer not null,
    "eventOccurrenceId" text not null references event_occurrence(id) on delete cascade,
    "eventRegionReviewRoundId" text not null references event_region_review_round(id) on delete cascade,
    kind text not null,
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
    constraint event_operational_communication_schedule_revision_ck check (revision > 0),
    constraint event_operational_communication_schedule_kind_ck check (kind in ('regional_review_due', 'regional_lock_due')),
    constraint event_operational_communication_schedule_attempts_ck check (attempts >= 0),
    constraint event_operational_communication_schedule_recipient_count_ck check ("recipientCount" is null or "recipientCount" >= 0),
    constraint event_operational_communication_schedule_status_ck check (status in ('pending', 'processing', 'completed', 'failed', 'superseded')),
    constraint event_operational_communication_schedule_state_ck check (
      (status in ('pending', 'processing') and "processedAt" is null and "supersededAt" is null and "recipientCount" is null)
      or (status = 'completed' and "processedAt" is not null and "supersededAt" is null and "recipientCount" is not null)
      or (status = 'failed' and "processedAt" is null and "supersededAt" is null and "recipientCount" is null and "lastErrorCode" is not null)
      or (status = 'superseded' and "processedAt" is null and "supersededAt" is not null and "recipientCount" is null)
    ),
    unique ("logicalId", revision)
  )`.execute(db);
  await sql`create unique index event_operational_communication_schedule_active_uq
    on event_operational_communication_schedule ("logicalId")
    where status in ('pending', 'processing')`.execute(db);
  await sql`create index event_operational_communication_schedule_due_idx
    on event_operational_communication_schedule ("availableAt", "dueAt", id)
    where status in ('pending', 'processing')`.execute(db);

  await sql`insert into event_region_review_round (
      id, "eventOccurrenceRegionId", round, "registrationClosesAt",
      "coordinatorLockAt", "lockedAt", "lockedByUserId", "lockSource",
      "eventOccurrenceRescheduleId"
    )
    select 'event_region_review_round_migration_0081_' || md5(region.id),
           region.id, 1, occurrence."registrationClosesAt",
           occurrence."coordinatorLockAt", null, null, null, null
      from event_occurrence_region region
      inner join event_occurrence occurrence
        on occurrence.id = region."eventOccurrenceId"
     where occurrence.status = 'published'
       and occurrence."approvalMode" = 'manual'
       and occurrence."registrationClosesAt" is not null
       and occurrence."coordinatorLockAt" is not null
       and region."retiredAt" is null
       and not exists (
         select 1 from event_region_review_round review
          where review."eventOccurrenceRegionId" = region.id
       )`.execute(db);

  await sql`insert into event_operational_communication_schedule (
      id, "logicalId", revision, "eventOccurrenceId",
      "eventRegionReviewRoundId", kind, "dueAt", status, attempts,
      "availableAt", "createdAt", "updatedAt"
    )
    select 'event_operational_communication_schedule_migration_0081_' ||
             md5(review.id || ':' || schedule.kind),
           review.id || ':' || schedule.kind, 1, occurrence.id, review.id,
           schedule.kind,
           case when schedule.kind = 'regional_review_due'
             then review."registrationClosesAt"
             else review."coordinatorLockAt"
           end,
           'pending', 0,
           case when schedule.kind = 'regional_review_due'
             then review."registrationClosesAt"
             else review."coordinatorLockAt"
           end,
           now(), now()
      from event_region_review_round review
      inner join event_occurrence_region region
        on region.id = review."eventOccurrenceRegionId"
      inner join event_occurrence occurrence
        on occurrence.id = region."eventOccurrenceId"
      cross join (values ('regional_review_due'), ('regional_lock_due'))
        as schedule(kind)
     where occurrence.status = 'published'
       and region."retiredAt" is null
       and review."lockedAt" is null
       and not exists (
         select 1 from event_region_review_round newer
          where newer."eventOccurrenceRegionId" = review."eventOccurrenceRegionId"
            and newer.round > review.round
       )`.execute(db);

  await sql`alter table event_template_version_communication
    drop constraint event_template_communication_trigger_ck`.execute(db);
  await sql
    .raw(
      `alter table event_template_version_communication
       add constraint event_template_communication_trigger_ck
       check (trigger in (${values(eventTriggers)}))`,
    )
    .execute(db);
  await sql`alter table event_occurrence_communication_revision
    drop constraint event_occurrence_communication_trigger_ck`.execute(db);
  await sql
    .raw(
      `alter table event_occurrence_communication_revision
       add constraint event_occurrence_communication_trigger_ck
       check (trigger in (${values(eventTriggers)}))`,
    )
    .execute(db);
  await sql`alter table event_communication_schedule
    drop constraint event_communication_schedule_trigger_ck,
    add constraint event_communication_schedule_trigger_ck
      check (trigger in ('event_start', 'event_end', 'session_start', 'prework_incomplete', 'post_event_incomplete'))`.execute(
    db,
  );

  await sql`alter table email_design
    drop constraint email_design_system_identity_ck,
    add constraint email_design_system_identity_ck check (
      (catalogue = 'system' and "systemKey" is not null
        and "contextKey" in ('system_account_setup', 'system_phone_verification', 'offering_event'))
      or (catalogue = 'offering' and "systemKey" is null
        and "contextKey" in ('offering_course', 'offering_event'))
    )`.execute(db);

  await sql`with next_position as (
      select coalesce(max(position), -1) + 1 as value
        from email_design
       where "contextKey" = 'offering_event'
    ), designs (id, name, "systemKey", position_offset) as (
      values
        ('email_design_system_event_regional_review_due', 'Regional review ready', 'event_regional_review_due', 0),
        ('email_design_system_event_regional_list_locked', 'Regional list locked', 'event_regional_list_locked', 1),
        ('email_design_system_event_late_registration_invitation', 'Late event registration invitation', 'event_late_registration_invitation', 2)
    )
    insert into email_design
      (id, catalogue, name, "contextKey", position, "systemKey", "activeVersionId", "createdByUserId", "createdAt", "updatedAt")
    select designs.id, 'system', designs.name, 'offering_event',
           next_position.value + designs.position_offset, designs."systemKey", null, null,
           now(), now()
      from designs cross join next_position
    on conflict (id) do nothing`.execute(db);
  await sql`insert into email_design_version
    (id, "emailDesignId", version, "contractKey", "contractVersion", subject, "textBody", "referencedVariables", "createdByUserId", "publishedByUserId", "publishedAt", "createdAt")
    values
      (
        'email_design_version_system_event_regional_review_due_v1',
        'email_design_system_event_regional_review_due', 1, 'offering.event', 1,
        'Regional review ready: {{event.title}} — {{event.reviewRegionName}}',
        E'Hello {{user.firstName}},\n\nRegistration review is ready for {{event.reviewRegionName}} for {{event.title}}. {{event.reviewPendingCount}} registration(s) still require a regional decision.\n\nComplete the review before {{event.coordinatorLockAt}}:\n{{event.operationsUrl}}',
        '["event.coordinatorLockAt", "event.operationsUrl", "event.reviewPendingCount", "event.reviewRegionName", "event.title", "user.firstName"]'::jsonb,
        null, null, now(), now()
      ),
      (
        'email_design_version_system_event_regional_list_locked_v1',
        'email_design_system_event_regional_list_locked', 1, 'offering.event', 1,
        'Regional list locked: {{event.title}} — {{event.reviewRegionName}}',
        E'Hello {{user.firstName}},\n\nThe {{event.reviewRegionName}} regional list for {{event.title}} was locked {{event.reviewLockSource}} with {{event.reviewRegistrationCount}} registration(s).\n\nReview the consolidated event list:\n{{event.operationsUrl}}',
        '["event.operationsUrl", "event.reviewLockSource", "event.reviewRegionName", "event.reviewRegistrationCount", "event.title", "user.firstName"]'::jsonb,
        null, null, now(), now()
      ),
      (
        'email_design_version_system_event_late_registration_invitation_v1',
        'email_design_system_event_late_registration_invitation', 1, 'offering.event', 1,
        'Invitation to register: {{event.title}}',
        E'Hello {{user.firstName}},\n\nYou have been invited to register for {{event.title}} on {{event.date}}. This personal invitation expires {{event.invitationExpiresAt}}.\n\nSign in and respond to the invitation:\n{{event.invitationUrl}}\n\nThis invitation can only be used by the account for {{user.email}}.',
        '["event.date", "event.invitationExpiresAt", "event.invitationUrl", "event.title", "user.email", "user.firstName"]'::jsonb,
        null, null, now(), now()
      )
    on conflict (id) do nothing`.execute(db);
  await sql`update email_design set "activeVersionId" = case id
      when 'email_design_system_event_regional_review_due' then 'email_design_version_system_event_regional_review_due_v1'
      when 'email_design_system_event_regional_list_locked' then 'email_design_version_system_event_regional_list_locked_v1'
      when 'email_design_system_event_late_registration_invitation' then 'email_design_version_system_event_late_registration_invitation_v1'
    end
    where id in (
      'email_design_system_event_regional_review_due',
      'email_design_system_event_regional_list_locked',
      'email_design_system_event_late_registration_invitation'
    )`.execute(db);

  await sql`alter table audit_event drop constraint audit_event_action_known_ck`.execute(
    db,
  );
  await sql
    .raw(
      `alter table audit_event add constraint audit_event_action_known_ck check (action in (${values(auditActions)}))`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`update email_design set "activeVersionId" = null
    where id in (
      'email_design_system_event_regional_review_due',
      'email_design_system_event_regional_list_locked',
      'email_design_system_event_late_registration_invitation'
    )`.execute(db);
  await sql`alter table email_design_version
    disable trigger email_design_version_immutable_trg`.execute(db);
  await sql`delete from email_design_version where id in (
    'email_design_version_system_event_regional_review_due_v1',
    'email_design_version_system_event_regional_list_locked_v1',
    'email_design_version_system_event_late_registration_invitation_v1'
  )`.execute(db);
  await sql`alter table email_design_version
    enable trigger email_design_version_immutable_trg`.execute(db);
  await sql`delete from email_design where id in (
    'email_design_system_event_regional_review_due',
    'email_design_system_event_regional_list_locked',
    'email_design_system_event_late_registration_invitation'
  )`.execute(db);
  await sql`alter table email_design
    drop constraint email_design_system_identity_ck,
    add constraint email_design_system_identity_ck check (
      (catalogue = 'system' and "systemKey" is not null
        and "contextKey" in ('system_account_setup', 'system_phone_verification'))
      or (catalogue = 'offering' and "systemKey" is null
        and "contextKey" in ('offering_course', 'offering_event'))
    )`.execute(db);
  // Invitation, schedule and audit evidence is otherwise retained. A rollback
  // with live evidence must fail safely instead of deleting operational history.
}
