import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`create function offline_scorm_utf16_length(input_text text)
    returns integer
    language sql immutable strict parallel safe
    as $$
      select char_length(input_text) + (
        select count(*)::integer
          from regexp_split_to_table(input_text, '') as code_point(value)
         where ascii(value) > 65535
      )
    $$`.execute(db);

  await sql`create function offline_scorm_signed_entitlement_matches(
    envelope jsonb, entitlement_id text, attempt_id text,
    installation_id text, user_id text, package_version_id text,
    package_sha256 text, runtime_version text, history_base_revision integer,
    issued_at timestamptz, intended_launch_expires_at timestamptz,
    commit_acceptance_deadline timestamptz
  ) returns boolean
  language plpgsql immutable strict
  as $$
  declare
    entitlement jsonb;
    offering jsonb;
    snapshot jsonb;
    score_key text;
    score_raw numeric;
    score_min numeric;
    score_max numeric;
    total_time numeric;
  begin
    if jsonb_typeof(envelope) <> 'object'
      or not envelope ?& array[
        'schemaVersion', 'algorithm', 'signingKeyId', 'entitlement', 'signature'
      ]
      or envelope - array[
        'schemaVersion', 'algorithm', 'signingKeyId', 'entitlement', 'signature'
      ]::text[] <> '{}'::jsonb
      or envelope -> 'schemaVersion' <> '1'::jsonb
      or jsonb_typeof(envelope -> 'algorithm') <> 'string'
      or envelope ->> 'algorithm' <> 'ecdsa-p256-sha256'
      or jsonb_typeof(envelope -> 'signingKeyId') <> 'string'
      or envelope ->> 'signingKeyId' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
      or jsonb_typeof(envelope -> 'signature') <> 'string'
      or envelope ->> 'signature' !~ '^[A-Za-z0-9_-]{86}$' then
      return false;
    end if;

    entitlement := envelope -> 'entitlement';
    if jsonb_typeof(entitlement) <> 'object'
      or not entitlement ?& array[
        'schemaVersion', 'entitlementId', 'attemptId', 'installationId',
        'learnerId', 'devicePublicKeySha256', 'historyBaseRevision',
        'runtimeVersion', 'offering', 'packageVersionId', 'packageSha256',
        'initialSnapshot', 'issuedAt', 'intendedLaunchExpiresAt',
        'commitAcceptanceDeadline'
      ]
      or entitlement - array[
        'schemaVersion', 'entitlementId', 'attemptId', 'installationId',
        'learnerId', 'devicePublicKeySha256', 'historyBaseRevision',
        'runtimeVersion', 'offering', 'packageVersionId', 'packageSha256',
        'initialSnapshot', 'issuedAt', 'intendedLaunchExpiresAt',
        'commitAcceptanceDeadline'
      ]::text[] <> '{}'::jsonb
      or entitlement -> 'schemaVersion' <> '1'::jsonb
      or jsonb_typeof(entitlement -> 'entitlementId') <> 'string'
      or entitlement ->> 'entitlementId' !~ '^[A-Za-z0-9_-]{1,255}$'
      or entitlement ->> 'entitlementId' <> entitlement_id
      or jsonb_typeof(entitlement -> 'attemptId') <> 'string'
      or entitlement ->> 'attemptId' !~ '^[A-Za-z0-9_-]{1,255}$'
      or entitlement ->> 'attemptId' <> attempt_id
      or jsonb_typeof(entitlement -> 'installationId') <> 'string'
      or entitlement ->> 'installationId' !~ '^[A-Za-z0-9_-]{1,255}$'
      or entitlement ->> 'installationId' <> installation_id
      or jsonb_typeof(entitlement -> 'learnerId') <> 'string'
      or entitlement ->> 'learnerId' !~ '^[A-Za-z0-9_-]{1,255}$'
      or entitlement ->> 'learnerId' <> user_id
      or jsonb_typeof(entitlement -> 'devicePublicKeySha256') <> 'string'
      or entitlement ->> 'devicePublicKeySha256' !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(entitlement -> 'historyBaseRevision') <> 'number'
      or entitlement -> 'historyBaseRevision' <> to_jsonb(history_base_revision)
      or jsonb_typeof(entitlement -> 'runtimeVersion') <> 'string'
      or entitlement ->> 'runtimeVersion' !~
        '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
      or entitlement ->> 'runtimeVersion' <> runtime_version
      or jsonb_typeof(entitlement -> 'packageVersionId') <> 'string'
      or entitlement ->> 'packageVersionId' !~ '^[A-Za-z0-9_-]{1,255}$'
      or entitlement ->> 'packageVersionId' <> package_version_id
      or jsonb_typeof(entitlement -> 'packageSha256') <> 'string'
      or entitlement ->> 'packageSha256' <> package_sha256
      or jsonb_typeof(entitlement -> 'issuedAt') <> 'string'
      or entitlement ->> 'issuedAt' !~
        '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}Z$'
      or (entitlement ->> 'issuedAt')::timestamptz <> issued_at
      or jsonb_typeof(entitlement -> 'intendedLaunchExpiresAt') <> 'string'
      or entitlement ->> 'intendedLaunchExpiresAt' !~
        '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}Z$'
      or (entitlement ->> 'intendedLaunchExpiresAt')::timestamptz <>
        intended_launch_expires_at
      or jsonb_typeof(entitlement -> 'commitAcceptanceDeadline') <> 'string'
      or entitlement ->> 'commitAcceptanceDeadline' !~
        '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}Z$'
      or (entitlement ->> 'commitAcceptanceDeadline')::timestamptz <>
        commit_acceptance_deadline
      or issued_at >= intended_launch_expires_at
      or intended_launch_expires_at >= commit_acceptance_deadline
      or commit_acceptance_deadline >
        intended_launch_expires_at + interval '30 days' then
      return false;
    end if;

    offering := entitlement -> 'offering';
    if jsonb_typeof(offering) <> 'object'
      or not (
        (
          offering ?& array['kind', 'enrollmentId', 'courseVersionItemId']
          and offering - array[
            'kind', 'enrollmentId', 'courseVersionItemId'
          ]::text[] = '{}'::jsonb
          and jsonb_typeof(offering -> 'kind') = 'string'
          and offering ->> 'kind' = 'course'
          and jsonb_typeof(offering -> 'enrollmentId') = 'string'
          and offering ->> 'enrollmentId' ~ '^[A-Za-z0-9_-]{1,255}$'
          and jsonb_typeof(offering -> 'courseVersionItemId') = 'string'
          and offering ->> 'courseVersionItemId' ~ '^[A-Za-z0-9_-]{1,255}$'
        ) or (
          offering ?& array[
            'kind', 'eventParticipationId', 'eventTemplateVersionItemId'
          ]
          and offering - array[
            'kind', 'eventParticipationId', 'eventTemplateVersionItemId'
          ]::text[] = '{}'::jsonb
          and jsonb_typeof(offering -> 'kind') = 'string'
          and offering ->> 'kind' = 'event'
          and jsonb_typeof(offering -> 'eventParticipationId') = 'string'
          and offering ->> 'eventParticipationId' ~ '^[A-Za-z0-9_-]{1,255}$'
          and jsonb_typeof(offering -> 'eventTemplateVersionItemId') = 'string'
          and offering ->> 'eventTemplateVersionItemId' ~
            '^[A-Za-z0-9_-]{1,255}$'
        )
      ) then
      return false;
    end if;

    snapshot := entitlement -> 'initialSnapshot';
    if jsonb_typeof(snapshot) <> 'object'
      or not snapshot ?& array[
        'lessonStatus', 'location', 'suspendData', 'scoreRaw', 'scoreMin',
        'scoreMax', 'totalTimeSeconds'
      ]
      or snapshot - array[
        'lessonStatus', 'location', 'suspendData', 'scoreRaw', 'scoreMin',
        'scoreMax', 'totalTimeSeconds'
      ]::text[] <> '{}'::jsonb
      or jsonb_typeof(snapshot -> 'lessonStatus') <> 'string'
      or snapshot ->> 'lessonStatus' not in (
        'not_attempted', 'incomplete', 'completed', 'passed', 'failed', 'browsed'
      )
      or jsonb_typeof(snapshot -> 'location') <> 'string'
      or offline_scorm_utf16_length(snapshot ->> 'location') > 1000
      or jsonb_typeof(snapshot -> 'suspendData') <> 'string'
      or offline_scorm_utf16_length(snapshot ->> 'suspendData') > 65536
      or jsonb_typeof(snapshot -> 'totalTimeSeconds') <> 'number' then
      return false;
    end if;

    foreach score_key in array array['scoreRaw', 'scoreMin', 'scoreMax'] loop
      if jsonb_typeof(snapshot -> score_key) not in ('null', 'number') then
        return false;
      end if;
      if jsonb_typeof(snapshot -> score_key) = 'number'
        and (snapshot ->> score_key)::numeric not between -100000 and 100000 then
        return false;
      end if;
    end loop;

    total_time := (snapshot ->> 'totalTimeSeconds')::numeric;
    if total_time <> trunc(total_time)
      or total_time not between 0 and 31536000 then
      return false;
    end if;
    if jsonb_typeof(snapshot -> 'scoreRaw') = 'number' then
      score_raw := (snapshot ->> 'scoreRaw')::numeric;
    end if;
    if jsonb_typeof(snapshot -> 'scoreMin') = 'number' then
      score_min := (snapshot ->> 'scoreMin')::numeric;
    end if;
    if jsonb_typeof(snapshot -> 'scoreMax') = 'number' then
      score_max := (snapshot ->> 'scoreMax')::numeric;
    end if;
    if score_min > score_max or score_raw < score_min or score_raw > score_max then
      return false;
    end if;
    return true;
  exception when others then
    return false;
  end
  $$`.execute(db);

  await sql`alter table offline_learning_entitlement
    add column "signedEnvelope" jsonb,
    add constraint offline_learning_entitlement_signed_envelope_ck check (
      "signedEnvelope" is null
      or offline_scorm_signed_entitlement_matches(
        "signedEnvelope", id, "attemptId", "installationId", "userId",
        "scormPackageVersionId", "packageSha256", "runtimeVersion",
        "historyBaseRevision", "issuedAt", "intendedLaunchExpiresAt",
        "commitAcceptanceDeadline"
      ) is true
    )`.execute(db);

  await sql`create function guard_offline_learning_entitlement_signed_envelope()
    returns trigger language plpgsql as $$
    declare
      envelope_device_key_sha256 text;
      installation_device_key_sha256 text;
      attempt_enrollment_id text;
      attempt_course_version_item_id text;
      attempt_event_participation_id text;
      attempt_event_template_version_item_id text;
      attempt_progress_revision integer;
      attempt_lesson_status text;
      attempt_location text;
      attempt_suspend_data text;
      attempt_score_raw numeric;
      attempt_score_min numeric;
      attempt_score_max numeric;
      attempt_total_time_seconds integer;
      expected_offering jsonb;
      expected_snapshot jsonb;
    begin
      if tg_op = 'INSERT' and new."signedEnvelope" is null then
        raise exception 'New offline entitlements require signed evidence'
          using errcode = '23514';
      end if;
      if tg_op = 'INSERT' and offline_scorm_signed_entitlement_matches(
        new."signedEnvelope", new.id, new."attemptId", new."installationId",
        new."userId", new."scormPackageVersionId", new."packageSha256",
        new."runtimeVersion", new."historyBaseRevision", new."issuedAt",
        new."intendedLaunchExpiresAt", new."commitAcceptanceDeadline"
      ) is true then
        envelope_device_key_sha256 := new."signedEnvelope" #>>
          '{entitlement,devicePublicKeySha256}';
        select installation."publicKeySha256"
          into installation_device_key_sha256
          from offline_learning_installation installation
         where installation.id = new."installationId"
           and installation."userId" = new."userId"
           for share;
        if installation_device_key_sha256 is null
          or envelope_device_key_sha256 <>
            installation_device_key_sha256 then
          raise exception 'Offline signed entitlement device key digest does not match installation'
            using errcode = '23514';
        end if;

        select attempt."enrollmentId", course_item.id,
               attempt."eventParticipationId",
               attempt."eventTemplateVersionItemId",
               attempt."progressRevision", attempt."lessonStatus",
               attempt.location, attempt."suspendData", attempt."scoreRaw",
               attempt."scoreMin", attempt."scoreMax",
               attempt."totalTimeSeconds"
          into attempt_enrollment_id, attempt_course_version_item_id,
               attempt_event_participation_id,
               attempt_event_template_version_item_id,
               attempt_progress_revision, attempt_lesson_status,
               attempt_location, attempt_suspend_data, attempt_score_raw,
               attempt_score_min, attempt_score_max,
               attempt_total_time_seconds
          from scorm_attempt attempt
          left join enrollment enrollment
            on enrollment.id = attempt."enrollmentId"
          left join course_version_item course_item
            on course_item."courseVersionId" = enrollment."courseVersionId"
           and course_item."modulePosition" = attempt."modulePosition"
           and course_item.kind = 'scorm'
           and course_item."learningActivityVersionId" =
             attempt."scormPackageVersionId"
         where attempt.id = new."attemptId"
           and attempt."scormPackageVersionId" =
             new."scormPackageVersionId"
         for update of attempt;

        if attempt_enrollment_id is not null
          and attempt_course_version_item_id is not null
          and attempt_event_participation_id is null
          and attempt_event_template_version_item_id is null then
          expected_offering := jsonb_build_object(
            'kind', 'course',
            'enrollmentId', attempt_enrollment_id,
            'courseVersionItemId', attempt_course_version_item_id
          );
        elsif attempt_enrollment_id is null
          and attempt_event_participation_id is not null
          and attempt_event_template_version_item_id is not null then
          expected_offering := jsonb_build_object(
            'kind', 'event',
            'eventParticipationId', attempt_event_participation_id,
            'eventTemplateVersionItemId',
              attempt_event_template_version_item_id
          );
        end if;
        if new."signedEnvelope" #> '{entitlement,offering}' is distinct from
          expected_offering then
          raise exception 'Offline signed entitlement offering does not match attempt'
            using errcode = '23514';
        end if;

        expected_snapshot := jsonb_build_object(
          'lessonStatus', attempt_lesson_status,
          'location', attempt_location,
          'suspendData', attempt_suspend_data,
          'scoreRaw', attempt_score_raw,
          'scoreMin', attempt_score_min,
          'scoreMax', attempt_score_max,
          'totalTimeSeconds', attempt_total_time_seconds
        );
        if attempt_progress_revision is distinct from
            new."historyBaseRevision"
          or new."signedEnvelope" #> '{entitlement,initialSnapshot}'
            is distinct from expected_snapshot then
          raise exception 'Offline signed entitlement snapshot does not match attempt history base'
            using errcode = '23514';
        end if;
      end if;
      if tg_op = 'UPDATE'
        and new."signedEnvelope" is distinct from old."signedEnvelope" then
        raise exception 'Offline signed entitlement evidence is immutable'
          using errcode = '23514';
      end if;
      return new;
    end
    $$`.execute(db);
  await sql`create trigger offline_learning_entitlement_signed_envelope_guard_trg
    before insert or update on offline_learning_entitlement
    for each row execute function
      guard_offline_learning_entitlement_signed_envelope()`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop trigger offline_learning_entitlement_signed_envelope_guard_trg
    on offline_learning_entitlement`.execute(db);
  await sql`drop function
    guard_offline_learning_entitlement_signed_envelope()`.execute(db);
  await sql`alter table offline_learning_entitlement
    drop constraint offline_learning_entitlement_signed_envelope_ck,
    drop column "signedEnvelope"`.execute(db);
  await sql`drop function offline_scorm_signed_entitlement_matches(
    jsonb, text, text, text, text, text, text, text, integer,
    timestamptz, timestamptz, timestamptz
  )`.execute(db);
  await sql`drop function offline_scorm_utf16_length(text)`.execute(db);
}
