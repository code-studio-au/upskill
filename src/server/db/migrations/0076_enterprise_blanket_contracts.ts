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

function values(items: ReadonlyArray<string>): string {
  return items.map((item) => `'${item}'`).join(", ");
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("enterprise_contract")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("organizationId", "text", (column) =>
      column.notNull().references("organization.id").onDelete("restrict"),
    )
    .addColumn("reference", "text", (column) => column.notNull())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) =>
      column.notNull().defaultTo("draft"),
    )
    .addColumn("startsAt", "timestamptz", (column) => column.notNull())
    .addColumn("expiresAt", "timestamptz", (column) => column.notNull())
    .addColumn("enrollmentDurationDays", "integer", (column) =>
      column.notNull(),
    )
    .addColumn("autoEnrollCourses", "boolean", (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn("createdByUserId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("createdAt", "timestamptz", (column) => column.notNull())
    .addColumn("activatedAt", "timestamptz")
    .addColumn("suspendedAt", "timestamptz")
    .addColumn("terminatedAt", "timestamptz")
    .addColumn("terminatedByUserId", "text", (column) =>
      column.references("user.id").onDelete("restrict"),
    )
    .addCheckConstraint(
      "enterprise_contract_reference_ck",
      sql`reference = btrim(reference) and char_length(reference) between 2 and 80`,
    )
    .addCheckConstraint(
      "enterprise_contract_name_ck",
      sql`name = btrim(name) and char_length(name) between 2 and 160`,
    )
    .addCheckConstraint(
      "enterprise_contract_status_ck",
      sql`status in ('draft', 'active', 'suspended', 'terminated')`,
    )
    .addCheckConstraint(
      "enterprise_contract_period_ck",
      sql`"expiresAt" > "startsAt"`,
    )
    .addCheckConstraint(
      "enterprise_contract_duration_ck",
      sql`"enrollmentDurationDays" between 1 and 3650`,
    )
    .addCheckConstraint(
      "enterprise_contract_lifecycle_ck",
      sql`(status = 'draft' and "activatedAt" is null and "suspendedAt" is null and "terminatedAt" is null and "terminatedByUserId" is null)
        or (status = 'active' and "activatedAt" is not null and "suspendedAt" is null and "terminatedAt" is null and "terminatedByUserId" is null)
        or (status = 'suspended' and "activatedAt" is not null and "suspendedAt" is not null and "terminatedAt" is null and "terminatedByUserId" is null)
        or (status = 'terminated' and "terminatedAt" is not null and "terminatedByUserId" is not null)`,
    )
    .execute();
  await db.schema
    .alterTable("enterprise_contract")
    .addColumn("renewedFromEnterpriseContractId", "text", (column) =>
      column.references("enterprise_contract.id").onDelete("restrict"),
    )
    .execute();
  await sql`create unique index enterprise_contract_renewal_uq
    on enterprise_contract ("renewedFromEnterpriseContractId")
    where "renewedFromEnterpriseContractId" is not null`.execute(db);
  await sql`create unique index enterprise_contract_reference_uq
    on enterprise_contract (lower(reference))`.execute(db);
  await db.schema
    .createIndex("enterprise_contract_organization_idx")
    .on("enterprise_contract")
    .columns(["organizationId", "status", "expiresAt"])
    .execute();

  await db.schema
    .createTable("enterprise_contract_course_coverage")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("enterpriseContractId", "text", (column) =>
      column
        .notNull()
        .references("enterprise_contract.id")
        .onDelete("restrict"),
    )
    .addColumn("courseId", "text", (column) =>
      column.notNull().references("course.id").onDelete("restrict"),
    )
    .addColumn("courseTitleSnapshot", "text", (column) => column.notNull())
    .addColumn("createdAt", "timestamptz", (column) => column.notNull())
    .addUniqueConstraint("enterprise_contract_course_coverage_uq", [
      "enterpriseContractId",
      "courseId",
    ])
    .addUniqueConstraint("enterprise_contract_coverage_identity_uq", [
      "id",
      "enterpriseContractId",
    ])
    .execute();

  await db.schema
    .createTable("enterprise_contract_domain")
    .addColumn("enterpriseContractId", "text", (column) =>
      column
        .notNull()
        .references("enterprise_contract.id")
        .onDelete("restrict"),
    )
    .addColumn("domain", "text", (column) => column.notNull())
    .addColumn("createdAt", "timestamptz", (column) => column.notNull())
    .addPrimaryKeyConstraint("enterprise_contract_domain_pk", [
      "enterpriseContractId",
      "domain",
    ])
    .addCheckConstraint(
      "enterprise_contract_domain_normalized_ck",
      sql`domain = lower(btrim(domain)) and position('.' in domain) > 0`,
    )
    .execute();

  await db.schema
    .createTable("enterprise_contract_event_coverage")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("enterpriseContractId", "text", (column) =>
      column
        .notNull()
        .references("enterprise_contract.id")
        .onDelete("restrict"),
    )
    .addColumn("eventOccurrenceId", "text", (column) =>
      column.notNull().references("event_occurrence.id").onDelete("restrict"),
    )
    .addColumn("eventTitleSnapshot", "text", (column) => column.notNull())
    .addColumn("createdAt", "timestamptz", (column) => column.notNull())
    .addUniqueConstraint("enterprise_contract_event_coverage_uq", [
      "enterpriseContractId",
      "eventOccurrenceId",
    ])
    .addUniqueConstraint("enterprise_contract_event_coverage_identity_uq", [
      "id",
      "enterpriseContractId",
    ])
    .execute();

  await db.schema
    .createTable("enterprise_contract_employee_eligibility")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("enterpriseContractId", "text", (column) =>
      column
        .notNull()
        .references("enterprise_contract.id")
        .onDelete("restrict"),
    )
    .addColumn("email", "text", (column) => column.notNull())
    .addColumn("name", "text")
    .addColumn("importedByUserId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("importedAt", "timestamptz", (column) => column.notNull())
    .addColumn("removedAt", "timestamptz")
    .addColumn("removedByUserId", "text", (column) =>
      column.references("user.id").onDelete("restrict"),
    )
    .addCheckConstraint(
      "enterprise_contract_employee_email_ck",
      sql`email = lower(btrim(email)) and position('@' in email) > 1`,
    )
    .addCheckConstraint(
      "enterprise_contract_employee_removal_ck",
      sql`("removedAt" is null) = ("removedByUserId" is null)`,
    )
    .execute();
  await sql`create unique index enterprise_contract_employee_active_uq
    on enterprise_contract_employee_eligibility ("enterpriseContractId", email)
    where "removedAt" is null`.execute(db);

  await db.schema
    .createTable("enterprise_contract_owner_assignment")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("enterpriseContractId", "text", (column) =>
      column
        .notNull()
        .references("enterprise_contract.id")
        .onDelete("restrict"),
    )
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("invitedEmail", "text", (column) => column.notNull())
    .addColumn("invitedByUserId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("invitedAt", "timestamptz", (column) => column.notNull())
    .addColumn("activatedAt", "timestamptz")
    .addColumn("revokedAt", "timestamptz")
    .addColumn("revokedByUserId", "text", (column) =>
      column.references("user.id").onDelete("restrict"),
    )
    .addCheckConstraint(
      "enterprise_contract_owner_email_ck",
      sql`"invitedEmail" = lower(btrim("invitedEmail")) and position('@' in "invitedEmail") > 1`,
    )
    .addCheckConstraint(
      "enterprise_contract_owner_revocation_ck",
      sql`("revokedAt" is null) = ("revokedByUserId" is null)`,
    )
    .execute();
  await sql`create unique index enterprise_contract_owner_active_uq
    on enterprise_contract_owner_assignment ("enterpriseContractId", lower("invitedEmail"))
    where "revokedAt" is null`.execute(db);
  await db.schema
    .createIndex("enterprise_contract_owner_user_idx")
    .on("enterprise_contract_owner_assignment")
    .columns(["userId", "revokedAt", "activatedAt"])
    .execute();

  await db.schema
    .createTable("enterprise_contract_code")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("enterpriseContractId", "text", (column) =>
      column
        .notNull()
        .references("enterprise_contract.id")
        .onDelete("restrict"),
    )
    .addColumn("lookupId", "text", (column) => column.notNull().unique())
    .addColumn("encryptedAccessCode", "text", (column) => column.notNull())
    .addColumn("createdByUserId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("createdAt", "timestamptz", (column) => column.notNull())
    .addColumn("revokedAt", "timestamptz")
    .addColumn("revokedByUserId", "text", (column) =>
      column.references("user.id").onDelete("restrict"),
    )
    .addCheckConstraint(
      "enterprise_contract_code_revocation_ck",
      sql`("revokedAt" is null) = ("revokedByUserId" is null)`,
    )
    .execute();
  await sql`create unique index enterprise_contract_code_active_uq
    on enterprise_contract_code ("enterpriseContractId")
    where "revokedAt" is null`.execute(db);

  await db.schema
    .createTable("enterprise_contract_claim")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("enterpriseContractId", "text", (column) =>
      column
        .notNull()
        .references("enterprise_contract.id")
        .onDelete("restrict"),
    )
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("emailSnapshot", "text", (column) => column.notNull())
    .addColumn("informationReleaseNoticeVersion", "text", (column) =>
      column.notNull(),
    )
    .addColumn("informationReleaseAcceptedAt", "timestamptz", (column) =>
      column.notNull(),
    )
    .addColumn("claimedAt", "timestamptz", (column) => column.notNull())
    .addColumn("revokedAt", "timestamptz")
    .addColumn("revokedByUserId", "text", (column) =>
      column.references("user.id").onDelete("restrict"),
    )
    .addCheckConstraint(
      "enterprise_contract_claim_revocation_ck",
      sql`("revokedAt" is null) = ("revokedByUserId" is null)`,
    )
    .addUniqueConstraint("enterprise_contract_claim_identity_uq", [
      "id",
      "enterpriseContractId",
    ])
    .execute();
  await sql`create unique index enterprise_contract_claim_user_uq
    on enterprise_contract_claim ("enterpriseContractId", "userId")
    where "revokedAt" is null`.execute(db);
  await db.schema
    .createIndex("enterprise_contract_claim_user_idx")
    .on("enterprise_contract_claim")
    .columns(["userId", "revokedAt", "enterpriseContractId"])
    .execute();

  await db.schema
    .createTable("enterprise_contract_event_registration")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("enterpriseContractId", "text", (column) =>
      column
        .notNull()
        .references("enterprise_contract.id")
        .onDelete("restrict"),
    )
    .addColumn("enterpriseContractClaimId", "text", (column) =>
      column
        .notNull()
        .references("enterprise_contract_claim.id")
        .onDelete("restrict"),
    )
    .addColumn("enterpriseContractEventCoverageId", "text", (column) =>
      column
        .notNull()
        .references("enterprise_contract_event_coverage.id")
        .onDelete("restrict"),
    )
    .addColumn("eventRegistrationId", "text", (column) =>
      column
        .notNull()
        .unique()
        .references("event_registration.id")
        .onDelete("restrict"),
    )
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("registeredAt", "timestamptz", (column) => column.notNull())
    .addUniqueConstraint("enterprise_contract_event_registration_user_uq", [
      "enterpriseContractEventCoverageId",
      "userId",
    ])
    .execute();
  await sql`alter table enterprise_contract_event_registration
    add constraint enterprise_contract_event_registration_claim_fk
      foreign key ("enterpriseContractClaimId", "enterpriseContractId")
      references enterprise_contract_claim (id, "enterpriseContractId") on delete restrict,
    add constraint enterprise_contract_event_registration_coverage_fk
      foreign key ("enterpriseContractEventCoverageId", "enterpriseContractId")
      references enterprise_contract_event_coverage (id, "enterpriseContractId") on delete restrict`.execute(
    db,
  );

  await sql`alter table event_registration
    drop constraint event_registration_source_ck,
    add constraint event_registration_source_ck check (source in (
      'ordinary', 'paid_checkout', 'access_code', 'enterprise_contract', 'late_invitation', 'administrator_override'
    )),
    drop constraint event_registration_eligibility_ck,
    add constraint event_registration_eligibility_ck check ("eligibilitySource" in (
      'unrestricted', 'paid', 'access_code', 'enterprise_contract', 'verified_domain', 'administrator_override'
    ))`.execute(db);

  await db.schema
    .alterTable("entitlement")
    .addColumn("originEnterpriseContractId", "text", (column) =>
      column.references("enterprise_contract.id").onDelete("restrict"),
    )
    .addColumn("originEnterpriseContractClaimId", "text", (column) =>
      column.references("enterprise_contract_claim.id").onDelete("restrict"),
    )
    .addColumn("originEnterpriseContractCoverageId", "text", (column) =>
      column
        .references("enterprise_contract_course_coverage.id")
        .onDelete("restrict"),
    )
    .execute();
  await sql`alter table entitlement
    add constraint entitlement_enterprise_claim_origin_fk
      foreign key ("originEnterpriseContractClaimId", "originEnterpriseContractId")
      references enterprise_contract_claim (id, "enterpriseContractId") on delete restrict,
    add constraint entitlement_enterprise_coverage_origin_fk
      foreign key ("originEnterpriseContractCoverageId", "originEnterpriseContractId")
      references enterprise_contract_course_coverage (id, "enterpriseContractId") on delete restrict`.execute(
    db,
  );
  await db.schema
    .alterTable("entitlement")
    .dropConstraint("entitlement_origin_ck")
    .execute();
  await db.schema
    .alterTable("entitlement")
    .addCheckConstraint(
      "entitlement_origin_ck",
      sql`(
        "originType" = 'access_grant' and "originAccessGrantId" is not null and "originOrderId" is null
        and "originEnterpriseContractId" is null and "originEnterpriseContractClaimId" is null and "originEnterpriseContractCoverageId" is null
      ) or (
        "originType" = 'order' and "originAccessGrantId" is null and "originOrderId" is not null
        and "originEnterpriseContractId" is null and "originEnterpriseContractClaimId" is null and "originEnterpriseContractCoverageId" is null
      ) or (
        "originType" = 'administrator' and "originAccessGrantId" is null and "originOrderId" is null
        and "originEnterpriseContractId" is null and "originEnterpriseContractClaimId" is null and "originEnterpriseContractCoverageId" is null
      ) or (
        "originType" = 'enterprise_contract' and "originAccessGrantId" is null and "originOrderId" is null
        and "originEnterpriseContractId" is not null and "originEnterpriseContractClaimId" is not null and "originEnterpriseContractCoverageId" is not null
      )`,
    )
    .execute();

  await sql`create or replace function upskill_guard_enterprise_contract_terms()
    returns trigger language plpgsql as $$
    begin
      if old.status <> 'draft' and (
        new."organizationId" is distinct from old."organizationId"
        or new.reference is distinct from old.reference
        or new.name is distinct from old.name
        or new."startsAt" is distinct from old."startsAt"
        or new."expiresAt" is distinct from old."expiresAt"
        or new."enrollmentDurationDays" is distinct from old."enrollmentDurationDays"
        or new."autoEnrollCourses" is distinct from old."autoEnrollCourses"
        or new."renewedFromEnterpriseContractId" is distinct from old."renewedFromEnterpriseContractId"
      ) then
        raise exception 'active enterprise contract terms are immutable';
      end if;
      return new;
    end $$`.execute(db);
  await sql`create trigger enterprise_contract_terms_guard
    before update on enterprise_contract
    for each row execute function upskill_guard_enterprise_contract_terms()`.execute(
    db,
  );

  await sql`create or replace function upskill_guard_enterprise_contract_child_terms()
    returns trigger language plpgsql as $$
    declare
      contract_id text;
      previous_contract_id text;
      contract_status text;
    begin
      if current_setting('upskill.enterprise_contract_maintenance', true) = 'on'
        and current_user not in ('upskill_web', 'upskill_worker') then
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end if;
      contract_id := case when tg_op = 'DELETE' then old."enterpriseContractId" else new."enterpriseContractId" end;
      select status into contract_status from enterprise_contract where id = contract_id;
      if contract_status is distinct from 'draft' then
        raise exception 'non-draft enterprise contract terms are immutable';
      end if;
      if tg_op = 'UPDATE' then
        previous_contract_id := old."enterpriseContractId";
        if previous_contract_id is distinct from contract_id then
          select status into contract_status from enterprise_contract where id = previous_contract_id;
          if contract_status is distinct from 'draft' then
            raise exception 'non-draft enterprise contract terms are immutable';
          end if;
        end if;
      end if;
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end $$`.execute(db);
  for (const table of [
    "enterprise_contract_course_coverage",
    "enterprise_contract_domain",
    "enterprise_contract_event_coverage",
  ])
    await sql
      .raw(
        `create trigger ${table}_terms_guard before insert or update or delete on ${table}
         for each row execute function upskill_guard_enterprise_contract_child_terms()`,
      )
      .execute(db);

  await sql`alter table audit_event drop constraint audit_event_action_known_ck`.execute(
    db,
  );
  await sql
    .raw(
      `alter table audit_event add constraint audit_event_action_known_ck check (action in (${values(auditActions)}))`,
    )
    .execute(db);
}

export async function down(): Promise<void> {
  // Contracts, claims, entitlements and their audit trail are commercial
  // evidence. This forward-only migration intentionally retains them.
}
