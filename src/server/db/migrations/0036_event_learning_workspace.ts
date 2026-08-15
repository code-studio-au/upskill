import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("event_participation")
    .addColumn("completedAt", "timestamptz")
    .execute();
  await db.schema
    .alterTable("event_template_version_section")
    .addColumn("phase", "text", (column) =>
      column.notNull().defaultTo("pre_event"),
    )
    .addColumn("releaseAnchor", "text", (column) =>
      column.notNull().defaultTo("participation_created"),
    )
    .addColumn("releaseOffsetAmount", "integer", (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn("releaseOffsetUnit", "text", (column) =>
      column.notNull().defaultTo("minute"),
    )
    .execute();
  await sql`alter table event_template_version_section
    add constraint event_template_section_release_ck check (
      phase in ('pre_event', 'session', 'post_event', 'follow_up')
      and "releaseAnchor" in (
        'participation_created', 'occurrence_start', 'occurrence_end', 'final_session_end'
      )
      and (
        ("releaseOffsetUnit" = 'minute' and "releaseOffsetAmount" between -5256000 and 5256000)
        or ("releaseOffsetUnit" = 'hour' and "releaseOffsetAmount" between -87600 and 87600)
        or ("releaseOffsetUnit" = 'day' and "releaseOffsetAmount" between -3650 and 3650)
        or ("releaseOffsetUnit" = 'week' and "releaseOffsetAmount" between -520 and 520)
        or ("releaseOffsetUnit" = 'month' and "releaseOffsetAmount" between -120 and 120)
      )
    )`.execute(db);

  await sql`alter table learning_item_progress
    add column id text,
    add column "eventParticipationId" text references event_participation(id) on delete restrict,
    add column "eventTemplateVersionItemId" text references event_template_version_item(id) on delete restrict`.execute(
    db,
  );
  await sql`update learning_item_progress
    set id = 'learning_progress_' || md5("enrollmentId" || ':' || "courseVersionItemId")`.execute(
    db,
  );
  await sql`alter table learning_item_progress
    drop constraint learning_item_progress_pk,
    alter column id set not null,
    alter column "enrollmentId" drop not null,
    alter column "courseVersionItemId" drop not null,
    add constraint learning_item_progress_pk primary key (id),
    add constraint learning_item_progress_owner_ck check (
      (("enrollmentId" is not null)::integer + ("eventParticipationId" is not null)::integer) = 1
      and (("courseVersionItemId" is not null)::integer + ("eventTemplateVersionItemId" is not null)::integer) = 1
      and (("enrollmentId" is not null) = ("courseVersionItemId" is not null))
    )`.execute(db);
  await db.schema
    .createIndex("learning_item_progress_course_uq")
    .unique()
    .on("learning_item_progress")
    .columns(["enrollmentId", "courseVersionItemId"])
    .where("enrollmentId", "is not", null)
    .execute();
  await db.schema
    .createIndex("learning_item_progress_event_uq")
    .unique()
    .on("learning_item_progress")
    .columns(["eventParticipationId", "eventTemplateVersionItemId"])
    .where("eventParticipationId", "is not", null)
    .execute();

  await sql`alter table survey_progress
    add column id text,
    add column "eventParticipationId" text references event_participation(id) on delete restrict,
    add column "eventTemplateVersionItemId" text references event_template_version_item(id) on delete restrict`.execute(
    db,
  );
  await sql`update survey_progress
    set id = 'survey_progress_' || md5("enrollmentId" || ':' || "courseVersionItemId")`.execute(
    db,
  );
  await sql`alter table survey_progress
    drop constraint survey_progress_pk,
    alter column id set not null,
    alter column "enrollmentId" drop not null,
    alter column "courseVersionItemId" drop not null,
    add constraint survey_progress_pk primary key (id),
    add constraint survey_progress_owner_ck check (
      (("enrollmentId" is not null)::integer + ("eventParticipationId" is not null)::integer) = 1
      and (("courseVersionItemId" is not null)::integer + ("eventTemplateVersionItemId" is not null)::integer) = 1
      and (("enrollmentId" is not null) = ("courseVersionItemId" is not null))
    )`.execute(db);
  await db.schema
    .createIndex("survey_progress_course_uq")
    .unique()
    .on("survey_progress")
    .columns(["enrollmentId", "courseVersionItemId"])
    .where("enrollmentId", "is not", null)
    .execute();
  await db.schema
    .createIndex("survey_progress_event_uq")
    .unique()
    .on("survey_progress")
    .columns(["eventParticipationId", "eventTemplateVersionItemId"])
    .where("eventParticipationId", "is not", null)
    .execute();

  await sql`alter table survey_response
    add column "eventParticipationId" text references event_participation(id) on delete restrict,
    add column "eventTemplateVersionItemId" text references event_template_version_item(id) on delete restrict,
    alter column "enrollmentId" drop not null,
    alter column "courseVersionItemId" drop not null,
    add constraint survey_response_owner_ck check (
      (("enrollmentId" is not null)::integer + ("eventParticipationId" is not null)::integer) = 1
      and (("courseVersionItemId" is not null)::integer + ("eventTemplateVersionItemId" is not null)::integer) = 1
      and (("enrollmentId" is not null) = ("courseVersionItemId" is not null))
    )`.execute(db);
  await db.schema
    .createIndex("survey_response_event_uq")
    .unique()
    .on("survey_response")
    .columns(["eventParticipationId", "eventTemplateVersionItemId"])
    .where("eventParticipationId", "is not", null)
    .execute();

  await sql`alter table scorm_attempt
    add column "eventParticipationId" text references event_participation(id) on delete restrict,
    add column "eventTemplateVersionItemId" text references event_template_version_item(id) on delete restrict,
    alter column "enrollmentId" drop not null,
    alter column "modulePosition" drop not null,
    drop constraint scorm_attempt_number_uq,
    add constraint scorm_attempt_owner_ck check (
      (("enrollmentId" is not null)::integer + ("eventParticipationId" is not null)::integer) = 1
      and (("modulePosition" is not null)::integer + ("eventTemplateVersionItemId" is not null)::integer) = 1
      and (("enrollmentId" is not null) = ("modulePosition" is not null))
    )`.execute(db);
  await db.schema
    .createIndex("scorm_attempt_course_number_uq")
    .unique()
    .on("scorm_attempt")
    .columns(["enrollmentId", "modulePosition", "attemptNumber"])
    .where("enrollmentId", "is not", null)
    .execute();
  await db.schema
    .createIndex("scorm_attempt_event_number_uq")
    .unique()
    .on("scorm_attempt")
    .columns([
      "eventParticipationId",
      "eventTemplateVersionItemId",
      "attemptNumber",
    ])
    .where("eventParticipationId", "is not", null)
    .execute();
  await sql`create view scorm_attempt_context as
    select attempt.id as "attemptId",
      coalesce(enrollment."userId", participation."userId") as "userId",
      attempt."enrollmentId",
      enrollment.status as "enrollmentStatus",
      enrollment."expiresAt" as "enrollmentExpiresAt",
      enrollment."removedAt",
      attempt."eventParticipationId",
      occurrence.status as "occurrenceStatus"
    from scorm_attempt attempt
    left join enrollment on enrollment.id = attempt."enrollmentId"
    left join event_participation participation on participation.id = attempt."eventParticipationId"
    left join event_occurrence occurrence on occurrence.id = participation."eventOccurrenceId"`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop view if exists scorm_attempt_context`.execute(db);
  await db.schema
    .dropIndex("scorm_attempt_event_number_uq")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("scorm_attempt_course_number_uq")
    .ifExists()
    .execute();
  await sql`alter table scorm_attempt
    drop constraint scorm_attempt_owner_ck,
    alter column "enrollmentId" set not null,
    alter column "modulePosition" set not null,
    add constraint scorm_attempt_number_uq unique ("enrollmentId", "modulePosition", "attemptNumber"),
    drop column "eventTemplateVersionItemId",
    drop column "eventParticipationId"`.execute(db);

  await db.schema.dropIndex("survey_response_event_uq").ifExists().execute();
  await sql`alter table survey_response
    drop constraint survey_response_owner_ck,
    alter column "enrollmentId" set not null,
    alter column "courseVersionItemId" set not null,
    drop column "eventTemplateVersionItemId",
    drop column "eventParticipationId"`.execute(db);

  await db.schema.dropIndex("survey_progress_event_uq").ifExists().execute();
  await db.schema.dropIndex("survey_progress_course_uq").ifExists().execute();
  await sql`alter table survey_progress
    drop constraint survey_progress_owner_ck,
    drop constraint survey_progress_pk,
    alter column "enrollmentId" set not null,
    alter column "courseVersionItemId" set not null,
    add constraint survey_progress_pk primary key ("enrollmentId", "courseVersionItemId"),
    drop column "eventTemplateVersionItemId",
    drop column "eventParticipationId",
    drop column id`.execute(db);

  await db.schema
    .dropIndex("learning_item_progress_event_uq")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("learning_item_progress_course_uq")
    .ifExists()
    .execute();
  await sql`alter table learning_item_progress
    drop constraint learning_item_progress_owner_ck,
    drop constraint learning_item_progress_pk,
    alter column "enrollmentId" set not null,
    alter column "courseVersionItemId" set not null,
    add constraint learning_item_progress_pk primary key ("enrollmentId", "courseVersionItemId"),
    drop column "eventTemplateVersionItemId",
    drop column "eventParticipationId",
    drop column id`.execute(db);

  await sql`alter table event_template_version_section
    drop constraint event_template_section_release_ck`.execute(db);
  await db.schema
    .alterTable("event_template_version_section")
    .dropColumn("releaseOffsetUnit")
    .dropColumn("releaseOffsetAmount")
    .dropColumn("releaseAnchor")
    .dropColumn("phase")
    .execute();
  await db.schema
    .alterTable("event_participation")
    .dropColumn("completedAt")
    .execute();
}
