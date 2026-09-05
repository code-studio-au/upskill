import { sql, type Kysely } from "kysely";

const previousAuditActions = [
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

const auditActions = [
  ...previousAuditActions,
  "event_virtual_room.created",
  "event_virtual_room.lifecycle_changed",
  "event_virtual_room.presenter_token_issued",
] as const;

function values(items: ReadonlyArray<string>): string {
  return items.map((item) => `'${item}'`).join(", ");
}

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`create table event_virtual_room (
    id text primary key,
    "eventSessionId" text not null references event_session(id) on delete restrict,
    provider text not null,
    generation integer not null,
    "providerRoomName" text not null unique,
    "providerRoomSid" text,
    "doorState" text not null,
    "admissionMode" text not null,
    "attendanceMode" text not null,
    "attendanceMinimumMinutes" integer,
    "recordingMode" text not null,
    "recordingRetentionDays" integer,
    "maxParticipants" integer not null,
    "providerStatus" text not null,
    "providerErrorCode" text,
    "createdByUserId" text not null references "user"(id) on delete restrict,
    "createdAt" timestamptz not null,
    "startedByUserId" text references "user"(id) on delete restrict,
    "startedAt" timestamptz,
    "lockedByUserId" text references "user"(id) on delete restrict,
    "lockedAt" timestamptz,
    "reopenedByUserId" text references "user"(id) on delete restrict,
    "reopenedAt" timestamptz,
    "endedByUserId" text references "user"(id) on delete restrict,
    "endedAt" timestamptz,
    "replacesRoomId" text unique,
    "replacedByUserId" text references "user"(id) on delete restrict,
    "replacedAt" timestamptz,
    constraint event_virtual_room_generation_uq unique ("eventSessionId", generation),
    constraint event_virtual_room_id_session_uq unique (id, "eventSessionId"),
    constraint event_virtual_room_replaces_session_fk foreign key (
      "replacesRoomId", "eventSessionId"
    ) references event_virtual_room (id, "eventSessionId") on delete restrict,
    constraint event_virtual_room_provider_ck check (provider = 'livekit'),
    constraint event_virtual_room_generation_ck check (generation >= 1),
    constraint event_virtual_room_name_ck check (
      char_length("providerRoomName") between 1 and 200
      and "providerRoomName" ~ '^[A-Za-z0-9:_-]+$'
    ),
    constraint event_virtual_room_door_ck check (
      "doorState" in ('scheduled', 'open', 'locked', 'ended')
      and (
        ("doorState" = 'scheduled' and "startedAt" is null and "endedAt" is null)
        or ("doorState" = 'open' and "startedAt" is not null and "endedAt" is null)
        or ("doorState" = 'locked' and "startedAt" is not null
          and "lockedAt" is not null and "endedAt" is null)
        or ("doorState" = 'ended' and "endedAt" is not null)
      )
    ),
    constraint event_virtual_room_actor_time_ck check (
      (("startedAt" is null) = ("startedByUserId" is null))
      and (("lockedAt" is null) = ("lockedByUserId" is null))
      and (("reopenedAt" is null) = ("reopenedByUserId" is null))
      and (("endedAt" is null) = ("endedByUserId" is null))
      and (("replacedAt" is null) = ("replacedByUserId" is null))
    ),
    constraint event_virtual_room_replacement_ck check (
      "replacesRoomId" is null or "replacesRoomId" <> id
    ),
    constraint event_virtual_room_admission_ck check (
      "admissionMode" in ('manual', 'automatic')
    ),
    constraint event_virtual_room_attendance_ck check (
      "attendanceMode" in ('manual', 'automatic_check_in', 'automatic_duration')
      and (
        ("attendanceMode" = 'automatic_duration'
          and "attendanceMinimumMinutes" between 1 and 10080)
        or ("attendanceMode" <> 'automatic_duration'
          and "attendanceMinimumMinutes" is null)
      )
    ),
    constraint event_virtual_room_recording_ck check (
      "recordingMode" in ('off', 'automatic')
      and (
        ("recordingMode" = 'off' and "recordingRetentionDays" is null)
        or ("recordingMode" = 'automatic'
          and "recordingRetentionDays" between 1 and 3650)
      )
    ),
    constraint event_virtual_room_capacity_ck check (
      "maxParticipants" between 2 and 10000
    ),
    constraint event_virtual_room_provider_status_ck check (
      "providerStatus" in ('pending', 'ready', 'error', 'closed')
      and (
        ("providerStatus" = 'error' and "providerErrorCode" is not null)
        or ("providerStatus" <> 'error' and "providerErrorCode" is null)
      )
    )
  )`.execute(db);
  await sql`create unique index event_virtual_room_current_uq
    on event_virtual_room ("eventSessionId")
    where "replacedAt" is null`.execute(db);
  await sql`create index event_virtual_room_operational_idx
    on event_virtual_room ("doorState", "providerStatus", "createdAt")
    where "replacedAt" is null`.execute(db);

  await sql`create table event_virtual_room_operation (
    id text primary key,
    "roomId" text not null references event_virtual_room(id) on delete restrict,
    kind text not null,
    "deduplicationKey" text not null unique,
    status text not null,
    attempts integer not null default 0,
    "availableAt" timestamptz not null,
    "leasedUntil" timestamptz,
    "lastAttemptAt" timestamptz,
    "completedAt" timestamptz,
    "lastErrorCode" text,
    "requestedByUserId" text references "user"(id) on delete restrict,
    "createdAt" timestamptz not null,
    constraint event_virtual_room_operation_kind_uq unique ("roomId", kind),
    constraint event_virtual_room_operation_kind_ck check (
      kind in ('ensure_room', 'close_room')
    ),
    constraint event_virtual_room_operation_state_ck check (
      attempts >= 0
      and (
        (status = 'pending' and "leasedUntil" is null and "completedAt" is null)
        or (status = 'processing' and "leasedUntil" is not null and "completedAt" is null)
        or (status = 'succeeded' and "leasedUntil" is null and "completedAt" is not null)
      )
    )
  )`.execute(db);
  await sql`create index event_virtual_room_operation_pending_idx
    on event_virtual_room_operation ("availableAt", "createdAt")
    where status = 'pending'`.execute(db);
  await sql`create index event_virtual_room_operation_lease_idx
    on event_virtual_room_operation ("leasedUntil")
    where status = 'processing'`.execute(db);

  await sql`alter table audit_event
    drop constraint audit_event_action_known_ck`.execute(db);
  await sql
    .raw(
      `alter table audit_event add constraint audit_event_action_known_ck check (action in (${values(auditActions)}))`,
    )
    .execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table audit_event
    drop constraint audit_event_action_known_ck`.execute(db);
  await sql
    .raw(
      `alter table audit_event add constraint audit_event_action_known_ck check (action in (${values(previousAuditActions)}))`,
    )
    .execute(db);
  await sql`drop index event_virtual_room_operation_pending_idx`.execute(db);
  await sql`drop index event_virtual_room_operation_lease_idx`.execute(db);
  await sql`drop table event_virtual_room_operation`.execute(db);
  await sql`drop index event_virtual_room_operational_idx`.execute(db);
  await sql`drop index event_virtual_room_current_uq`.execute(db);
  await sql`drop table event_virtual_room`.execute(db);
}
