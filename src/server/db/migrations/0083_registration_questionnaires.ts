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
  "registration_questionnaire.waived",
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
  await sql`alter table learning_activity
    drop constraint learning_activity_survey_usage_ck,
    drop constraint learning_activity_survey_catalogue_ck`.execute(db);
  await sql`alter table learning_activity
    add constraint learning_activity_survey_usage_ck check (
      (kind = 'survey' and "surveyUsage" in ('learning', 'onboarding', 'registration'))
      or (kind <> 'survey' and "surveyUsage" is null)
    ),
    add constraint learning_activity_survey_catalogue_ck check (
      (kind = 'survey'
        and "surveyType" in ('system', 'registration', 'elearning', 'event', 'shared')
        and "surveyPosition" is not null
        and "surveyPosition" >= 0)
      or (kind <> 'survey'
        and "surveyType" is null
        and "surveyPosition" is null)
    )`.execute(db);

  await sql`alter table course_version
    add column "registrationSurveyVersionId" text
      references survey_version(id) on delete restrict`.execute(db);
  await sql`alter table event_template_version
    add column "registrationSurveyVersionId" text
      references survey_version(id) on delete restrict`.execute(db);

  await sql`create table registration_questionnaire_assignment (
    id text primary key,
    "userId" text not null references "user"(id) on delete restrict,
    "surveyVersionId" text not null references survey_version(id) on delete restrict,
    "eventOccurrenceId" text references event_occurrence(id) on delete restrict,
    "eventOccurrenceRegionId" text references event_occurrence_region(id) on delete restrict,
    "enrollmentId" text references enrollment(id) on delete restrict,
    status text not null check (status in ('assigned', 'in_progress', 'completed', 'waived')),
    "assignedAt" timestamptz not null,
    "startedAt" timestamptz,
    "completedAt" timestamptz,
    "waivedAt" timestamptz,
    "waivedByUserId" text references "user"(id) on delete restrict,
    "waiverReason" text,
    constraint registration_questionnaire_assignment_target_ck check (
      (("eventOccurrenceId" is not null)::integer + ("enrollmentId" is not null)::integer) = 1
      and ("eventOccurrenceRegionId" is null or "eventOccurrenceId" is not null)
    ),
    constraint registration_questionnaire_assignment_state_ck check (
      (status = 'assigned' and "startedAt" is null and "completedAt" is null and "waivedAt" is null)
      or (status = 'in_progress' and "startedAt" is not null and "completedAt" is null and "waivedAt" is null)
      or (status = 'completed' and "startedAt" is not null and "completedAt" is not null and "waivedAt" is null)
      or (status = 'waived' and "completedAt" is null and "waivedAt" is not null
        and "waivedByUserId" is not null and char_length(btrim("waiverReason")) between 2 and 1000)
    )
  )`.execute(db);
  await sql`create unique index registration_questionnaire_assignment_event_uq
    on registration_questionnaire_assignment ("eventOccurrenceId", "userId")
    where "eventOccurrenceId" is not null`.execute(db);
  await sql`create unique index registration_questionnaire_assignment_enrollment_uq
    on registration_questionnaire_assignment ("enrollmentId")
    where "enrollmentId" is not null`.execute(db);
  await sql`create index registration_questionnaire_assignment_user_idx
    on registration_questionnaire_assignment ("userId", "assignedAt" desc)`.execute(
    db,
  );

  await sql`create table registration_questionnaire_response (
    id text primary key,
    "assignmentId" text not null unique
      references registration_questionnaire_assignment(id) on delete restrict,
    "surveyVersionId" text not null references survey_version(id) on delete restrict,
    answers jsonb not null default '{}'::jsonb,
    "visitedItemIds" jsonb not null default '[]'::jsonb,
    "currentItemId" text,
    "startedAt" timestamptz not null,
    "updatedAt" timestamptz not null,
    "submittedAt" timestamptz,
    "profileUpdateAcceptedAt" timestamptz,
    "redactedAt" timestamptz,
    constraint registration_questionnaire_response_answers_ck
      check (jsonb_typeof(answers) = 'object'),
    constraint registration_questionnaire_response_visited_ck
      check (jsonb_typeof("visitedItemIds") = 'array'),
    constraint registration_questionnaire_response_profile_update_ck
      check ("profileUpdateAcceptedAt" is null or "submittedAt" is not null)
  )`.execute(db);
  await sql`create index registration_questionnaire_response_submitted_idx
    on registration_questionnaire_response ("submittedAt" desc)
    where "submittedAt" is not null`.execute(db);
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
  await sql`drop index registration_questionnaire_response_submitted_idx`.execute(
    db,
  );
  await sql`drop table registration_questionnaire_response`.execute(db);
  await sql`drop index registration_questionnaire_assignment_user_idx`.execute(
    db,
  );
  await sql`drop index registration_questionnaire_assignment_enrollment_uq`.execute(
    db,
  );
  await sql`drop index registration_questionnaire_assignment_event_uq`.execute(
    db,
  );
  await sql`drop table registration_questionnaire_assignment`.execute(db);
  await sql`alter table event_template_version
    drop column "registrationSurveyVersionId"`.execute(db);
  await sql`alter table course_version
    drop column "registrationSurveyVersionId"`.execute(db);
  await sql`alter table learning_activity
    drop constraint learning_activity_survey_usage_ck,
    drop constraint learning_activity_survey_catalogue_ck`.execute(db);
  await sql`alter table learning_activity
    add constraint learning_activity_survey_usage_ck check (
      (kind = 'survey' and "surveyUsage" in ('learning', 'onboarding'))
      or (kind <> 'survey' and "surveyUsage" is null)
    ),
    add constraint learning_activity_survey_catalogue_ck check (
      (kind = 'survey'
        and "surveyType" in ('system', 'elearning', 'event', 'shared')
        and "surveyPosition" is not null
        and "surveyPosition" >= 0)
      or (kind <> 'survey'
        and "surveyType" is null
        and "surveyPosition" is null)
    )`.execute(db);
}
