import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("event_template")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("slug", "text", (column) => column.notNull().unique())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) =>
      column.notNull().defaultTo("draft"),
    )
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "event_template_status_ck",
      sql`status in ('draft', 'published', 'archived')`,
    )
    .execute();

  await db.schema
    .createTable("event_template_version")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventTemplateId", "text", (column) =>
      column.notNull().references("event_template.id").onDelete("restrict"),
    )
    .addColumn("version", "integer", (column) => column.notNull())
    .addColumn("summary", "text", (column) => column.notNull())
    .addColumn("description", "text", (column) => column.notNull())
    .addColumn("hasCompletionCertificate", "boolean", (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn("publishedAt", "timestamptz")
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("event_template_version_number_uq", [
      "eventTemplateId",
      "version",
    ])
    .addCheckConstraint("event_template_version_number_ck", sql`version > 0`)
    .execute();

  await db.schema
    .createTable("coordination_region")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("parentId", "text", (column) =>
      column.references("coordination_region.id").onDelete("restrict"),
    )
    .addColumn("code", "text", (column) => column.notNull().unique())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) =>
      column.notNull().defaultTo("active"),
    )
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "coordination_region_status_ck",
      sql`status in ('active', 'retired')`,
    )
    .addCheckConstraint(
      "coordination_region_parent_ck",
      sql`"parentId" is null or "parentId" <> id`,
    )
    .execute();

  await db.schema
    .createTable("event_template_version_region")
    .addColumn("eventTemplateVersionId", "text", (column) =>
      column
        .notNull()
        .references("event_template_version.id")
        .onDelete("cascade"),
    )
    .addColumn("regionId", "text", (column) =>
      column
        .notNull()
        .references("coordination_region.id")
        .onDelete("restrict"),
    )
    .addColumn("position", "integer", (column) => column.notNull())
    .addPrimaryKeyConstraint("event_template_version_region_pk", [
      "eventTemplateVersionId",
      "regionId",
    ])
    .addUniqueConstraint("event_template_version_region_position_uq", [
      "eventTemplateVersionId",
      "position",
    ])
    .addCheckConstraint(
      "event_template_version_region_position_ck",
      sql`position >= 0`,
    )
    .execute();

  await db.schema
    .createTable("event_template_version_admin_default")
    .addColumn("eventTemplateVersionId", "text", (column) =>
      column
        .notNull()
        .references("event_template_version.id")
        .onDelete("cascade"),
    )
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("event_template_version_admin_default_pk", [
      "eventTemplateVersionId",
      "userId",
    ])
    .execute();

  await db.schema
    .createTable("event_template_version_coordinator_default")
    .addColumn("eventTemplateVersionId", "text", (column) => column.notNull())
    .addColumn("regionId", "text", (column) => column.notNull())
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addForeignKeyConstraint(
      "event_template_coordinator_region_fk",
      ["eventTemplateVersionId", "regionId"],
      "event_template_version_region",
      ["eventTemplateVersionId", "regionId"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addPrimaryKeyConstraint("event_template_coordinator_default_pk", [
      "eventTemplateVersionId",
      "regionId",
      "userId",
    ])
    .execute();

  await db.schema
    .createTable("event_template_session_definition")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventTemplateVersionId", "text", (column) =>
      column
        .notNull()
        .references("event_template_version.id")
        .onDelete("cascade"),
    )
    .addColumn("position", "integer", (column) => column.notNull())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("durationMinutes", "integer", (column) => column.notNull())
    .addColumn("presenterRequired", "boolean", (column) =>
      column.notNull().defaultTo(true),
    )
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("event_template_session_position_uq", [
      "eventTemplateVersionId",
      "position",
    ])
    .addUniqueConstraint("event_template_session_identity_uq", [
      "id",
      "eventTemplateVersionId",
    ])
    .addCheckConstraint(
      "event_template_session_values_ck",
      sql`position >= 0 and "durationMinutes" > 0`,
    )
    .execute();

  await db.schema
    .createTable("event_template_version_presenter_default")
    .addColumn("eventTemplateVersionId", "text", (column) =>
      column
        .notNull()
        .references("event_template_version.id")
        .onDelete("cascade"),
    )
    .addColumn("sessionDefinitionId", "text")
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("scopeKey", "text", (column) => column.notNull())
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addForeignKeyConstraint(
      "event_template_presenter_session_fk",
      ["sessionDefinitionId", "eventTemplateVersionId"],
      "event_template_session_definition",
      ["id", "eventTemplateVersionId"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addPrimaryKeyConstraint("event_template_presenter_default_pk", [
      "eventTemplateVersionId",
      "scopeKey",
      "userId",
    ])
    .addCheckConstraint(
      "event_template_presenter_scope_ck",
      sql`("sessionDefinitionId" is null and "scopeKey" = 'occurrence')
        or ("sessionDefinitionId" is not null and "scopeKey" = "sessionDefinitionId")`,
    )
    .execute();

  await db.schema
    .createTable("event_occurrence")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventTemplateVersionId", "text", (column) =>
      column
        .notNull()
        .references("event_template_version.id")
        .onDelete("restrict"),
    )
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) =>
      column.notNull().defaultTo("draft"),
    )
    .addColumn("deliveryMode", "text", (column) => column.notNull())
    .addColumn("registrationMode", "text", (column) => column.notNull())
    .addColumn("approvalMode", "text", (column) => column.notNull())
    .addColumn("timezone", "text", (column) => column.notNull())
    .addColumn("startsAt", "timestamptz", (column) => column.notNull())
    .addColumn("endsAt", "timestamptz", (column) => column.notNull())
    .addColumn("registrationOpensAt", "timestamptz")
    .addColumn("registrationClosesAt", "timestamptz")
    .addColumn("coordinatorLockAt", "timestamptz")
    .addColumn("capacity", "integer", (column) => column.notNull())
    .addColumn("confirmedCount", "integer", (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn("venueName", "text")
    .addColumn("venueAddress", "text")
    .addColumn("virtualJoinUrl", "text")
    .addColumn("administratorAttentionRequired", "boolean", (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn("coordinatorAttentionRequired", "boolean", (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn("presenterAttentionRequired", "boolean", (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn("publishedAt", "timestamptz")
    .addColumn("createdByUserId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "event_occurrence_status_ck",
      sql`status in ('draft', 'published', 'cancelled', 'completed', 'archived')`,
    )
    .addCheckConstraint(
      "event_occurrence_delivery_mode_ck",
      sql`"deliveryMode" in ('in_person', 'virtual', 'hybrid')`,
    )
    .addCheckConstraint(
      "event_occurrence_registration_mode_ck",
      sql`"registrationMode" in ('open_entry', 'required_unrestricted', 'required_restricted')`,
    )
    .addCheckConstraint(
      "event_occurrence_approval_mode_ck",
      sql`"approvalMode" in ('automatic', 'manual')`,
    )
    .addCheckConstraint(
      "event_occurrence_schedule_ck",
      sql`"endsAt" > "startsAt"
        and ("registrationOpensAt" is null or "registrationClosesAt" is null or "registrationClosesAt" > "registrationOpensAt")
        and ("coordinatorLockAt" is null or "registrationClosesAt" is null or "coordinatorLockAt" >= "registrationClosesAt")`,
    )
    .addCheckConstraint(
      "event_occurrence_capacity_ck",
      sql`capacity > 0 and "confirmedCount" >= 0 and "confirmedCount" <= capacity`,
    )
    .addCheckConstraint(
      "event_occurrence_location_ck",
      sql`("deliveryMode" <> 'in_person' or "venueName" is not null)
        and ("deliveryMode" <> 'virtual' or "virtualJoinUrl" is not null)
        and ("deliveryMode" <> 'hybrid' or ("venueName" is not null and "virtualJoinUrl" is not null))`,
    )
    .execute();

  await db.schema
    .createIndex("event_occurrence_schedule_idx")
    .on("event_occurrence")
    .columns(["startsAt", "status"])
    .execute();

  await db.schema
    .createTable("event_occurrence_domain")
    .addColumn("eventOccurrenceId", "text", (column) =>
      column.notNull().references("event_occurrence.id").onDelete("cascade"),
    )
    .addColumn("domain", "text", (column) => column.notNull())
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("event_occurrence_domain_pk", [
      "eventOccurrenceId",
      "domain",
    ])
    .addCheckConstraint(
      "event_occurrence_domain_format_ck",
      sql`domain = lower(domain)
        and domain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'`,
    )
    .execute();

  await db.schema
    .createTable("event_occurrence_region")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventOccurrenceId", "text", (column) =>
      column.notNull().references("event_occurrence.id").onDelete("cascade"),
    )
    .addColumn("regionId", "text", (column) =>
      column
        .notNull()
        .references("coordination_region.id")
        .onDelete("restrict"),
    )
    .addColumn("position", "integer", (column) => column.notNull())
    .addColumn("retiredAt", "timestamptz")
    .addUniqueConstraint("event_occurrence_region_identity_uq", [
      "eventOccurrenceId",
      "regionId",
    ])
    .addUniqueConstraint("event_occurrence_region_position_uq", [
      "eventOccurrenceId",
      "position",
    ])
    .addCheckConstraint(
      "event_occurrence_region_position_ck",
      sql`position >= 0`,
    )
    .execute();

  await db.schema
    .createTable("event_session")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventOccurrenceId", "text", (column) =>
      column.notNull().references("event_occurrence.id").onDelete("cascade"),
    )
    .addColumn("sessionDefinitionId", "text", (column) =>
      column
        .notNull()
        .references("event_template_session_definition.id")
        .onDelete("restrict"),
    )
    .addColumn("position", "integer", (column) => column.notNull())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("startsAt", "timestamptz", (column) => column.notNull())
    .addColumn("endsAt", "timestamptz", (column) => column.notNull())
    .addColumn("presenterRequired", "boolean", (column) => column.notNull())
    .addColumn("venueName", "text")
    .addColumn("venueAddress", "text")
    .addColumn("virtualJoinUrl", "text")
    .addUniqueConstraint("event_session_position_uq", [
      "eventOccurrenceId",
      "position",
    ])
    .addUniqueConstraint("event_session_definition_uq", [
      "eventOccurrenceId",
      "sessionDefinitionId",
    ])
    .addCheckConstraint(
      "event_session_schedule_ck",
      sql`position >= 0 and "endsAt" > "startsAt"`,
    )
    .execute();

  await db.schema
    .createTable("event_admin_assignment")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventOccurrenceId", "text", (column) =>
      column.notNull().references("event_occurrence.id").onDelete("restrict"),
    )
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("source", "text", (column) => column.notNull())
    .addColumn("assignedByUserId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("assignedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("endedAt", "timestamptz")
    .addColumn("endReason", "text")
    .addCheckConstraint(
      "event_admin_assignment_source_ck",
      sql`source in ('template_default', 'occurrence_local', 'replacement')`,
    )
    .addCheckConstraint(
      "event_admin_assignment_end_ck",
      sql`("endedAt" is null and "endReason" is null)
        or ("endedAt" is not null and "endReason" in ('assignment_ended', 'platform_admin_revoked', 'user_disabled', 'replaced'))`,
    )
    .execute();

  await sql`create index event_admin_assignment_active_idx
    on event_admin_assignment ("eventOccurrenceId", "userId")
    where "endedAt" is null`.execute(db);

  await db.schema
    .createTable("event_coordinator_assignment")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventOccurrenceRegionId", "text", (column) =>
      column
        .notNull()
        .references("event_occurrence_region.id")
        .onDelete("restrict"),
    )
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("source", "text", (column) => column.notNull())
    .addColumn("assignedByUserId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("assignedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("endedAt", "timestamptz")
    .addColumn("endReason", "text")
    .addCheckConstraint(
      "event_coordinator_assignment_source_ck",
      sql`source in ('template_default', 'occurrence_local', 'replacement')`,
    )
    .addCheckConstraint(
      "event_coordinator_assignment_end_ck",
      sql`("endedAt" is null and "endReason" is null)
        or ("endedAt" is not null and "endReason" in ('assignment_ended', 'user_disabled', 'replaced'))`,
    )
    .execute();

  await sql`create index event_coordinator_assignment_active_idx
    on event_coordinator_assignment ("eventOccurrenceRegionId", "userId")
    where "endedAt" is null`.execute(db);

  await db.schema
    .createTable("event_presenter_assignment")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventOccurrenceId", "text", (column) =>
      column.notNull().references("event_occurrence.id").onDelete("restrict"),
    )
    .addColumn("eventSessionId", "text", (column) =>
      column.references("event_session.id").onDelete("restrict"),
    )
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("scopeKey", "text", (column) => column.notNull())
    .addColumn("source", "text", (column) => column.notNull())
    .addColumn("assignedByUserId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("assignedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("endedAt", "timestamptz")
    .addColumn("endReason", "text")
    .addCheckConstraint(
      "event_presenter_assignment_scope_ck",
      sql`("eventSessionId" is null and "scopeKey" = 'occurrence')
        or ("eventSessionId" is not null and "scopeKey" = "eventSessionId")`,
    )
    .addCheckConstraint(
      "event_presenter_assignment_source_ck",
      sql`source in ('template_default', 'occurrence_local', 'replacement')`,
    )
    .addCheckConstraint(
      "event_presenter_assignment_end_ck",
      sql`("endedAt" is null and "endReason" is null)
        or ("endedAt" is not null and "endReason" in ('assignment_ended', 'user_disabled', 'replaced'))`,
    )
    .execute();

  await sql`create index event_presenter_assignment_active_idx
    on event_presenter_assignment ("eventOccurrenceId", "scopeKey", "userId")
    where "endedAt" is null`.execute(db);

  await db.schema
    .createTable("event_region_review_round")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventOccurrenceRegionId", "text", (column) =>
      column
        .notNull()
        .references("event_occurrence_region.id")
        .onDelete("restrict"),
    )
    .addColumn("round", "integer", (column) => column.notNull())
    .addColumn("registrationClosesAt", "timestamptz", (column) =>
      column.notNull(),
    )
    .addColumn("coordinatorLockAt", "timestamptz", (column) => column.notNull())
    .addColumn("lockedAt", "timestamptz")
    .addColumn("lockedByUserId", "text", (column) =>
      column.references("user.id").onDelete("restrict"),
    )
    .addColumn("lockSource", "text")
    .addUniqueConstraint("event_region_review_round_number_uq", [
      "eventOccurrenceRegionId",
      "round",
    ])
    .addCheckConstraint(
      "event_region_review_round_values_ck",
      sql`round > 0 and "coordinatorLockAt" >= "registrationClosesAt"
        and (("lockedAt" is null and "lockSource" is null)
          or ("lockedAt" is not null and "lockSource" in ('manual', 'deadline', 'administrator')))`,
    )
    .execute();

  await db.schema
    .createTable("event_registration")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventOccurrenceId", "text", (column) =>
      column.notNull().references("event_occurrence.id").onDelete("restrict"),
    )
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("eventOccurrenceRegionId", "text", (column) =>
      column.references("event_occurrence_region.id").onDelete("restrict"),
    )
    .addColumn("reviewRoundId", "text", (column) =>
      column.references("event_region_review_round.id").onDelete("restrict"),
    )
    .addColumn("nameSnapshot", "text", (column) => column.notNull())
    .addColumn("emailSnapshot", "text", (column) => column.notNull())
    .addColumn("source", "text", (column) => column.notNull())
    .addColumn("eligibilitySource", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("coordinatorPriority", "integer")
    .addColumn("submittedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("coordinatorDecidedAt", "timestamptz")
    .addColumn("coordinatorDecidedByUserId", "text", (column) =>
      column.references("user.id").onDelete("restrict"),
    )
    .addColumn("finalDecidedAt", "timestamptz")
    .addColumn("finalDecidedByUserId", "text", (column) =>
      column.references("user.id").onDelete("restrict"),
    )
    .addColumn("lockedInAt", "timestamptz")
    .addUniqueConstraint("event_registration_user_uq", [
      "eventOccurrenceId",
      "userId",
    ])
    .addCheckConstraint(
      "event_registration_source_ck",
      sql`source in ('ordinary', 'late_invitation', 'administrator_override')`,
    )
    .addCheckConstraint(
      "event_registration_eligibility_ck",
      sql`"eligibilitySource" in ('unrestricted', 'verified_domain', 'administrator_override')`,
    )
    .addCheckConstraint(
      "event_registration_status_ck",
      sql`status in ('submitted', 'coordinator_approved', 'coordinator_declined', 'selected', 'waitlisted', 'not_selected', 'withdrawn', 'cancelled')`,
    )
    .addCheckConstraint(
      "event_registration_locked_in_ck",
      sql`("lockedInAt" is null) = (status <> 'selected')`,
    )
    .execute();

  await db.schema
    .createIndex("event_registration_selection_idx")
    .on("event_registration")
    .columns(["eventOccurrenceId", "status", "coordinatorPriority"])
    .execute();

  await db.schema
    .createTable("event_participation")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventOccurrenceId", "text", (column) =>
      column.notNull().references("event_occurrence.id").onDelete("restrict"),
    )
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("registrationId", "text", (column) =>
      column.references("event_registration.id").onDelete("restrict").unique(),
    )
    .addColumn("mode", "text", (column) => column.notNull())
    .addColumn("nameSnapshot", "text", (column) => column.notNull())
    .addColumn("emailSnapshot", "text", (column) => column.notNull())
    .addColumn("detailsSubmittedAt", "timestamptz")
    .addColumn("joinDisclosedAt", "timestamptz")
    .addColumn("checkedInAt", "timestamptz")
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("event_participation_user_uq", [
      "eventOccurrenceId",
      "userId",
    ])
    .addCheckConstraint(
      "event_participation_mode_ck",
      sql`(mode = 'registered' and "registrationId" is not null)
        or (mode = 'open_entry' and "registrationId" is null)`,
    )
    .execute();

  await db.schema
    .createTable("event_attendance")
    .addColumn("eventParticipationId", "text", (column) =>
      column
        .notNull()
        .references("event_participation.id")
        .onDelete("restrict"),
    )
    .addColumn("eventSessionId", "text", (column) =>
      column.notNull().references("event_session.id").onDelete("restrict"),
    )
    .addColumn("state", "text", (column) => column.notNull())
    .addColumn("source", "text", (column) => column.notNull())
    .addColumn("recordedByUserId", "text", (column) =>
      column.references("user.id").onDelete("restrict"),
    )
    .addColumn("recordedAt", "timestamptz", (column) => column.notNull())
    .addColumn("updatedAt", "timestamptz", (column) => column.notNull())
    .addPrimaryKeyConstraint("event_attendance_pk", [
      "eventParticipationId",
      "eventSessionId",
    ])
    .addCheckConstraint(
      "event_attendance_state_ck",
      sql`state in ('not_recorded', 'checked_in', 'attended', 'absent')`,
    )
    .addCheckConstraint(
      "event_attendance_source_ck",
      sql`source in ('system', 'self_check_in', 'coordinator', 'presenter', 'administrator')`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "event_attendance",
    "event_participation",
    "event_registration",
    "event_region_review_round",
    "event_presenter_assignment",
    "event_coordinator_assignment",
    "event_admin_assignment",
    "event_session",
    "event_occurrence_region",
    "event_occurrence_domain",
    "event_occurrence",
    "event_template_version_presenter_default",
    "event_template_session_definition",
    "event_template_version_coordinator_default",
    "event_template_version_admin_default",
    "event_template_version_region",
    "coordination_region",
    "event_template_version",
    "event_template",
  ])
    await db.schema.dropTable(table).ifExists().execute();
}
