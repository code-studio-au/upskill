import { sql, type Kysely } from "kysely";

const auditActions = [
  "access_grant.owner_activated",
  "access_grant.owner_assigned",
  "access_grant.owner_code_revealed",
  "access_grant.owner_revoked",
  "access_grant.administrator_capacity_updated",
  "access_grant.administrator_code_revealed",
  "access_grant.administrator_created",
  "access_grant.administrator_revoked",
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
  "event_occurrence.created",
  "event_occurrence.guest_access_rotated",
  "event_occurrence.updated",
  "event_occurrence.published",
  "event_occurrence.lifecycle_changed",
  "event_occurrence.rescheduled",
  "event_staff.eligibility_granted",
  "event_staff.eligibility_revoked",
  "coordination_region.created",
  "coordination_region.updated",
  "coordination_region.retired",
  "coordination_region.reactivated",
  "event_attendance.recorded",
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
  "survey.version_created",
  "user.phone_verification_transferred",
  "user.provisional_created",
  "user.account_activated",
  "user.account_setup_resent",
  "user.onboarding_reassigned",
  "user.region_updated",
] as const;

function constraint(values: ReadonlyArray<string>): string {
  return values.map((value) => `'${value}'`).join(", ");
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table sms_delivery
    add column "recipientUserId" text references "user"(id) on delete set null,
    add column "recipientNameSnapshot" text,
    add constraint sms_delivery_recipient_name_ck check (
      "recipientNameSnapshot" is null
      or char_length(btrim("recipientNameSnapshot")) between 1 and 160
    )`.execute(db);
  await sql`update sms_delivery sms
    set "recipientUserId" = challenge."userId",
        "recipientNameSnapshot" = recipient.name
    from contact_verification_challenge challenge
    join "user" recipient on recipient.id = challenge."userId"
    where challenge.id = sms.id`.execute(db);
  await sql`update sms_delivery sms
    set "recipientUserId" = challenge."userId",
        "recipientNameSnapshot" = recipient.name
    from event_prerequisite_recovery_challenge challenge
    join "user" recipient on recipient.id = challenge."userId"
    where challenge.id = sms.id
      and sms."recipientUserId" is null`.execute(db);
  await sql`create index sms_delivery_recipient_user_idx
    on sms_delivery ("recipientUserId", "createdAt" desc)
    where "recipientUserId" is not null`.execute(db);

  await sql`create table phone_verification_claim (
    id text primary key,
    phone text not null,
    "userId" text not null references "user"(id) on delete cascade,
    "verificationChallengeId" text references contact_verification_challenge(id) on delete set null,
    "claimedAt" timestamptz not null,
    "releasedAt" timestamptz,
    "releaseReason" text,
    "createdAt" timestamptz not null default now(),
    constraint phone_verification_claim_phone_ck
      check (phone ~ '^[+][1-9][0-9]{7,14}$'),
    constraint phone_verification_claim_release_ck check (
      ("releasedAt" is null and "releaseReason" is null)
      or (
        "releasedAt" is not null
        and "releasedAt" >= "claimedAt"
        and "releaseReason" in (
          'transferred', 'reverified', 'phone_changed', 'migration_duplicate'
        )
      )
    )
  )`.execute(db);
  await sql`with ranked as (
      select id,
             phone,
             "smsVerifiedAt" as "claimedAt",
             max("smsVerifiedAt") over (partition by phone) as "latestClaimedAt",
             row_number() over (
               partition by phone
               order by "smsVerifiedAt" desc, id desc
             ) as rank
      from "user"
      where phone is not null and "smsVerifiedAt" is not null
    )
    insert into phone_verification_claim (
      id, phone, "userId", "claimedAt", "releasedAt", "releaseReason", "createdAt"
    )
    select 'phone_claim_migrated_' || md5(id || ':' || phone),
           phone,
           id,
           "claimedAt",
           case when rank = 1 then null else "latestClaimedAt" end,
           case when rank = 1 then null else 'migration_duplicate' end,
           "claimedAt"
    from ranked`.execute(db);
  await sql`with ranked as (
      select id,
             row_number() over (
               partition by phone
               order by "smsVerifiedAt" desc, id desc
             ) as rank
      from "user"
      where phone is not null and "smsVerifiedAt" is not null
    )
    update "user" recipient
       set "smsVerifiedAt" = null,
           "updatedAt" = now()
      from ranked
     where ranked.id = recipient.id
       and ranked.rank > 1`.execute(db);
  await sql`create unique index phone_verification_claim_active_phone_uq
    on phone_verification_claim (phone) where "releasedAt" is null`.execute(db);
  await sql`create index phone_verification_claim_user_history_idx
    on phone_verification_claim ("userId", "claimedAt" desc, id desc)`.execute(
    db,
  );
  await sql`create unique index user_sms_verified_phone_uq
    on "user" (phone) where "smsVerifiedAt" is not null`.execute(db);

  await sql`alter table notification drop constraint notification_template_ck`.execute(
    db,
  );
  await sql`alter table notification add constraint notification_template_ck
    check ("templateKey" in (
      'account_setup_requested',
      'phone_verification_transferred',
      'offering_course',
      'offering_event'
    ))`.execute(db);
  await sql`alter table email_design
    drop constraint email_design_system_identity_ck,
    drop constraint email_design_context_ck`.execute(db);
  await sql`alter table email_design add constraint email_design_context_ck
    check ("contextKey" in (
      'system_account_setup',
      'system_phone_verification',
      'offering_course',
      'offering_event'
    ))`.execute(db);
  await sql`alter table email_design add constraint email_design_system_identity_ck check (
    (
      catalogue = 'system'
      and "systemKey" is not null
      and "contextKey" in ('system_account_setup', 'system_phone_verification')
    )
    or (
      catalogue = 'offering'
      and "systemKey" is null
      and "contextKey" in ('offering_course', 'offering_event')
    )
  )`.execute(db);
  await sql`insert into email_design (
    id, catalogue, name, "contextKey", "systemKey", position, "createdAt", "updatedAt"
  ) values (
    'email_design_system_phone_verification_transferred',
    'system',
    'Mobile number moved to another account',
    'system_phone_verification',
    'phone_verification_transferred',
    0,
    now(),
    now()
  )`.execute(db);
  await sql`insert into email_design_version (
    id, "emailDesignId", version, "contractKey", "contractVersion",
    subject, "textBody", "referencedVariables", "publishedAt", "createdAt"
  ) values (
    'email_design_version_system_phone_verification_transferred_v1',
    'email_design_system_phone_verification_transferred',
    1,
    'system.phone_verification_transferred',
    1,
    'Your Upskill mobile number was verified on another account',
    E'Hello {{user.fullName}},\\n\\nThe mobile number ending in {{phone.lastFour}} is no longer verified on your Upskill account because it was successfully verified on another account. SMS survey access is unavailable for this number until you verify it again.\\n\\nIf you still control this number, sign in to verify it again or add a new mobile number:\\n\\n{{account.profileUrl}}\\n\\nIf you did not expect this change, contact {{platform.supportEmail}}.',
    '["account.profileUrl", "phone.lastFour", "platform.supportEmail", "user.fullName"]'::jsonb,
    now(),
    now()
  )`.execute(db);
  await sql`update email_design
    set "activeVersionId" = 'email_design_version_system_phone_verification_transferred_v1'
    where id = 'email_design_system_phone_verification_transferred'`.execute(
    db,
  );

  await sql`alter table audit_event drop constraint audit_event_action_known_ck`.execute(
    db,
  );
  await sql
    .raw(
      `alter table audit_event add constraint audit_event_action_known_ck check (action in (${constraint(auditActions)}))`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`update email_design
    set "activeVersionId" = null
    where id = 'email_design_system_phone_verification_transferred'`.execute(
    db,
  );
  await sql`alter table email_design_version
    disable trigger email_design_version_immutable_trg`.execute(db);
  await sql`delete from email_design_version
    where id = 'email_design_version_system_phone_verification_transferred_v1'`.execute(
    db,
  );
  await sql`alter table email_design_version
    enable trigger email_design_version_immutable_trg`.execute(db);
  await sql`delete from email_design
    where id = 'email_design_system_phone_verification_transferred'`.execute(
    db,
  );
  await sql`alter table email_design
    drop constraint email_design_system_identity_ck,
    drop constraint email_design_context_ck`.execute(db);
  await sql`alter table email_design add constraint email_design_context_ck
    check ("contextKey" in ('system_account_setup', 'offering_course', 'offering_event'))`.execute(
    db,
  );
  await sql`alter table email_design add constraint email_design_system_identity_ck check (
    (catalogue = 'system' and "systemKey" is not null and "contextKey" = 'system_account_setup')
    or (catalogue = 'offering' and "systemKey" is null and "contextKey" in ('offering_course', 'offering_event'))
  )`.execute(db);
  await sql`alter table notification drop constraint notification_template_ck`.execute(
    db,
  );
  await sql`alter table notification add constraint notification_template_ck
    check ("templateKey" in ('account_setup_requested', 'offering_course', 'offering_event'))`.execute(
    db,
  );

  await sql`drop index user_sms_verified_phone_uq`.execute(db);
  await sql`drop table phone_verification_claim`.execute(db);
  await sql`drop index sms_delivery_recipient_user_idx`.execute(db);
  await sql`alter table sms_delivery
    drop constraint sms_delivery_recipient_name_ck,
    drop column "recipientNameSnapshot",
    drop column "recipientUserId"`.execute(db);
  // The expanded audit constraint remains because audit rows are append-only.
}
