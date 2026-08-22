import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table course_version_communication
    disable trigger course_version_communication_immutable_trg`.execute(db);
  await sql`alter table event_template_version_communication
    disable trigger event_template_communication_immutable_trg`.execute(db);

  await sql`insert into course_version_section
      (id, "courseVersionId", position, title, description)
    select 'course_email_section_' || md5(version.id), version.id, 0,
           'Communications', ''
      from course_version version
     where exists (
       select 1 from course_version_communication communication
        where communication."courseVersionId" = version.id
          and communication."sectionId" is null
     )
       and not exists (
         select 1 from course_version_section section
          where section."courseVersionId" = version.id
       )`.execute(db);
  await sql`insert into event_template_version_section
      (id, "eventTemplateVersionId", position, title, description, phase,
       "releaseAnchor", "releaseOffsetAmount", "releaseOffsetUnit")
    select 'event_email_section_' || md5(version.id), version.id, 0,
           'Communications', '', 'pre_event', 'participation_created', 0, 'minute'
      from event_template_version version
     where exists (
       select 1 from event_template_version_communication communication
        where communication."eventTemplateVersionId" = version.id
          and communication."sectionId" is null
     )
       and not exists (
         select 1 from event_template_version_section section
          where section."eventTemplateVersionId" = version.id
       )`.execute(db);

  await sql`update course_version_communication communication
    set "sectionId" = (
      select candidate.id
        from course_version_section candidate
       where candidate."courseVersionId" = communication."courseVersionId"
       order by candidate.position, candidate.id
       limit 1
    )
    where communication."sectionId" is null`.execute(db);
  await sql`update event_template_version_communication communication
    set "sectionId" = (
      select candidate.id
        from event_template_version_section candidate
       where candidate."eventTemplateVersionId" = communication."eventTemplateVersionId"
       order by candidate.position, candidate.id
       limit 1
    )
    where communication."sectionId" is null`.execute(db);

  await sql`drop index course_version_communication_position_uq`.execute(db);
  await sql`drop index event_template_communication_position_uq`.execute(db);

  await sql`with positioned as (
      select communication.id,
             coalesce((
               select max(item.position) + 1
                 from course_version_item item
                where item."sectionId" = communication."sectionId"
             ), 0) + row_number() over (
               partition by communication."sectionId"
               order by communication.position, communication.id
             ) - 1 as position
        from course_version_communication communication
    )
    update course_version_communication communication
       set position = positioned.position
      from positioned
     where positioned.id = communication.id`.execute(db);
  await sql`with positioned as (
      select communication.id,
             coalesce((
               select max(item.position) + 1
                 from event_template_version_item item
                where item."sectionId" = communication."sectionId"
             ), 0) + row_number() over (
               partition by communication."sectionId"
               order by communication.position, communication.id
             ) - 1 as position
        from event_template_version_communication communication
    )
    update event_template_version_communication communication
       set position = positioned.position
      from positioned
     where positioned.id = communication.id`.execute(db);

  await sql`create unique index course_version_communication_position_uq
    on course_version_communication ("sectionId", position)
    where "sectionId" is not null`.execute(db);
  await sql`create unique index event_template_communication_position_uq
    on event_template_version_communication ("sectionId", position)
    where "sectionId" is not null`.execute(db);

  await sql`alter table course_version_communication
    enable trigger course_version_communication_immutable_trg`.execute(db);
  await sql`alter table event_template_version_communication
    enable trigger event_template_communication_immutable_trg`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table course_version_communication
    disable trigger course_version_communication_immutable_trg`.execute(db);
  await sql`alter table event_template_version_communication
    disable trigger event_template_communication_immutable_trg`.execute(db);
  await sql`drop index course_version_communication_position_uq`.execute(db);
  await sql`drop index event_template_communication_position_uq`.execute(db);
  await sql`with positioned as (
      select id, row_number() over (
        partition by "courseVersionId" order by position, id
      ) - 1 as position
      from course_version_communication
    )
    update course_version_communication communication
       set position = positioned.position
      from positioned where positioned.id = communication.id`.execute(db);
  await sql`with positioned as (
      select id, row_number() over (
        partition by "eventTemplateVersionId" order by position, id
      ) - 1 as position
      from event_template_version_communication
    )
    update event_template_version_communication communication
       set position = positioned.position
      from positioned where positioned.id = communication.id`.execute(db);
  await sql`create unique index course_version_communication_position_uq
    on course_version_communication ("courseVersionId", position)`.execute(db);
  await sql`create unique index event_template_communication_position_uq
    on event_template_version_communication ("eventTemplateVersionId", position)`.execute(
    db,
  );
  await sql`alter table course_version_communication
    enable trigger course_version_communication_immutable_trg`.execute(db);
  await sql`alter table event_template_version_communication
    enable trigger event_template_communication_immutable_trg`.execute(db);
}
