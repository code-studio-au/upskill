import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_template_session_definition
    add column "livekitAdmissionMode" text not null default 'automatic',
    add column "livekitAttendanceMode" text not null default 'manual',
    add column "livekitAttendanceMinimumMinutes" integer,
    add column "livekitPresenterPreparationMinutes" integer not null default 60,
    add column "livekitAttendeeRejoinGraceMinutes" integer not null default 10,
    add column "livekitCapacityHeadroom" integer not null default 5,
    add column "livekitOpenEntryGuestsAllowed" boolean not null default false,
    add column "livekitRecordingMode" text not null default 'off',
    add column "livekitRecordingRetentionDays" integer,
    add column "livekitAttendeeRecordingNotice" text not null default '',
    add column "livekitPresenterRecordingNotice" text not null default '',
    add constraint event_template_session_livekit_policy_ck check (
      "livekitAdmissionMode" in ('manual', 'automatic')
      and "livekitAttendanceMode" in ('manual', 'automatic_check_in', 'automatic_duration')
      and (
        ("livekitAttendanceMode" = 'automatic_duration'
          and "livekitAttendanceMinimumMinutes" between 1 and "durationMinutes")
        or ("livekitAttendanceMode" <> 'automatic_duration'
          and "livekitAttendanceMinimumMinutes" is null)
      )
      and "livekitPresenterPreparationMinutes" between 0 and 1440
      and "livekitAttendeeRejoinGraceMinutes" between 0 and 120
      and "livekitCapacityHeadroom" between 1 and 100
      and "livekitRecordingMode" in ('off', 'automatic')
      and (
        ("livekitRecordingMode" = 'off'
          and "livekitRecordingRetentionDays" is null
          and "livekitAttendeeRecordingNotice" = ''
          and "livekitPresenterRecordingNotice" = '')
        or ("livekitRecordingMode" = 'automatic'
          and "livekitRecordingRetentionDays" between 1 and 3650
          and length(trim("livekitAttendeeRecordingNotice")) >= 2
          and length(trim("livekitPresenterRecordingNotice")) >= 2)
      )
    )`.execute(db);

  await sql`alter table event_occurrence
    add column "virtualDeliveryProvider" text`.execute(db);
  await sql`update event_occurrence
    set "virtualDeliveryProvider" = 'external_url'
    where "deliveryMode" = 'virtual'`.execute(db);
  await sql`alter table event_occurrence
    drop constraint event_occurrence_location_ck,
    add constraint event_occurrence_virtual_provider_ck check (
      "virtualDeliveryProvider" is null
      or "virtualDeliveryProvider" in ('external_url', 'livekit')
    ),
    add constraint event_occurrence_location_ck check (
      ("deliveryMode" = 'in_person'
        and "virtualDeliveryProvider" is null
        and "venueName" is not null
        and "virtualJoinUrl" is null)
      or ("deliveryMode" = 'virtual'
        and "virtualDeliveryProvider" = 'external_url'
        and "virtualJoinUrl" is not null
        and "venueName" is null
        and "venueAddress" is null)
      or ("deliveryMode" = 'virtual'
        and "virtualDeliveryProvider" = 'livekit'
        and "virtualJoinUrl" is null
        and "venueName" is null
        and "venueAddress" is null)
    )`.execute(db);

  await sql`alter table event_session
    add column "virtualDeliveryProvider" text,
    add column "livekitAdmissionMode" text,
    add column "livekitAttendanceMode" text,
    add column "livekitAttendanceMinimumMinutes" integer,
    add column "livekitPresenterPreparationMinutes" integer,
    add column "livekitAttendeeRejoinGraceMinutes" integer,
    add column "livekitCapacityHeadroom" integer,
    add column "livekitOpenEntryGuestsAllowed" boolean,
    add column "livekitRecordingMode" text,
    add column "livekitRecordingRetentionDays" integer,
    add column "livekitAttendeeRecordingNotice" text,
    add column "livekitPresenterRecordingNotice" text`.execute(db);
  await sql`update event_session session
    set "virtualDeliveryProvider" = 'external_url'
    from event_occurrence occurrence
    where occurrence.id = session."eventOccurrenceId"
      and occurrence."deliveryMode" = 'virtual'`.execute(db);
  await sql`alter table event_session
    add constraint event_session_livekit_delivery_ck check (
      ("virtualDeliveryProvider" is null
        and "venueName" is not null
        and "virtualJoinUrl" is null
        and "livekitAdmissionMode" is null
        and "livekitAttendanceMode" is null
        and "livekitAttendanceMinimumMinutes" is null
        and "livekitPresenterPreparationMinutes" is null
        and "livekitAttendeeRejoinGraceMinutes" is null
        and "livekitCapacityHeadroom" is null
        and "livekitOpenEntryGuestsAllowed" is null
        and "livekitRecordingMode" is null
        and "livekitRecordingRetentionDays" is null
        and "livekitAttendeeRecordingNotice" is null
        and "livekitPresenterRecordingNotice" is null)
      or ("virtualDeliveryProvider" = 'external_url'
        and "venueName" is null
        and "venueAddress" is null
        and "virtualJoinUrl" is not null
        and "livekitAdmissionMode" is null
        and "livekitAttendanceMode" is null
        and "livekitAttendanceMinimumMinutes" is null
        and "livekitPresenterPreparationMinutes" is null
        and "livekitAttendeeRejoinGraceMinutes" is null
        and "livekitCapacityHeadroom" is null
        and "livekitOpenEntryGuestsAllowed" is null
        and "livekitRecordingMode" is null
        and "livekitRecordingRetentionDays" is null
        and "livekitAttendeeRecordingNotice" is null
        and "livekitPresenterRecordingNotice" is null)
      or ("virtualDeliveryProvider" = 'livekit'
        and "venueName" is null
        and "venueAddress" is null
        and "virtualJoinUrl" is null
        and "livekitAdmissionMode" in ('manual', 'automatic')
        and "livekitAttendanceMode" in ('manual', 'automatic_check_in', 'automatic_duration')
        and (
          ("livekitAttendanceMode" = 'automatic_duration'
            and "livekitAttendanceMinimumMinutes" between 1
              and extract(epoch from ("endsAt" - "startsAt")) / 60)
          or ("livekitAttendanceMode" <> 'automatic_duration'
            and "livekitAttendanceMinimumMinutes" is null)
        )
        and "livekitPresenterPreparationMinutes" between 0 and 1440
        and "livekitAttendeeRejoinGraceMinutes" between 0 and 120
        and "livekitCapacityHeadroom" between 1 and 100
        and "livekitOpenEntryGuestsAllowed" is not null
        and "livekitRecordingMode" in ('off', 'automatic')
        and (
          ("livekitRecordingMode" = 'off'
            and "livekitRecordingRetentionDays" is null
            and "livekitAttendeeRecordingNotice" = ''
            and "livekitPresenterRecordingNotice" = '')
          or ("livekitRecordingMode" = 'automatic'
            and "livekitRecordingRetentionDays" between 1 and 3650
            and length(trim("livekitAttendeeRecordingNotice")) >= 2
            and length(trim("livekitPresenterRecordingNotice")) >= 2)
        )
      )
    )`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`do $$
    begin
      if exists (
        select 1 from event_occurrence
        where "virtualDeliveryProvider" = 'livekit'
      ) then
        raise exception 'Cannot remove LiveKit provider policy while LiveKit occurrences exist';
      end if;
    end
  $$`.execute(db);

  await sql`alter table event_session
    drop constraint event_session_livekit_delivery_ck,
    drop column "virtualDeliveryProvider",
    drop column "livekitAdmissionMode",
    drop column "livekitAttendanceMode",
    drop column "livekitAttendanceMinimumMinutes",
    drop column "livekitPresenterPreparationMinutes",
    drop column "livekitAttendeeRejoinGraceMinutes",
    drop column "livekitCapacityHeadroom",
    drop column "livekitOpenEntryGuestsAllowed",
    drop column "livekitRecordingMode",
    drop column "livekitRecordingRetentionDays",
    drop column "livekitAttendeeRecordingNotice",
    drop column "livekitPresenterRecordingNotice"`.execute(db);
  await sql`alter table event_occurrence
    drop constraint event_occurrence_location_ck,
    drop constraint event_occurrence_virtual_provider_ck,
    drop column "virtualDeliveryProvider",
    add constraint event_occurrence_location_ck check (
      ("deliveryMode" = 'in_person' and "venueName" is not null and "virtualJoinUrl" is null)
      or ("deliveryMode" = 'virtual' and "virtualJoinUrl" is not null and "venueName" is null and "venueAddress" is null)
    )`.execute(db);
  await sql`alter table event_template_session_definition
    drop constraint event_template_session_livekit_policy_ck,
    drop column "livekitAdmissionMode",
    drop column "livekitAttendanceMode",
    drop column "livekitAttendanceMinimumMinutes",
    drop column "livekitPresenterPreparationMinutes",
    drop column "livekitAttendeeRejoinGraceMinutes",
    drop column "livekitCapacityHeadroom",
    drop column "livekitOpenEntryGuestsAllowed",
    drop column "livekitRecordingMode",
    drop column "livekitRecordingRetentionDays",
    drop column "livekitAttendeeRecordingNotice",
    drop column "livekitPresenterRecordingNotice"`.execute(db);
}
