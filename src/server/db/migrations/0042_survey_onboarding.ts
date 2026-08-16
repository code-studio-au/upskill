import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table learning_activity add column "surveyUsage" text`.execute(
    db,
  );
  await sql`update learning_activity set "surveyUsage" = 'learning' where kind = 'survey'`.execute(
    db,
  );
  await sql`alter table learning_activity add constraint learning_activity_survey_usage_ck check (
    (kind = 'survey' and "surveyUsage" in ('learning', 'onboarding'))
    or (kind <> 'survey' and "surveyUsage" is null)
  )`.execute(db);

  await sql`create table onboarding_definition (
    id text primary key,
    name text not null,
    "createdAt" timestamptz not null
  )`.execute(db);
  await sql`create table onboarding_definition_version (
    id text primary key,
    "definitionId" text not null references onboarding_definition(id) on delete cascade,
    version integer not null check (version > 0),
    "surveyVersionId" text not null references survey_version(id),
    "privacyNotice" text not null,
    "privacyNoticeVersion" text not null,
    "profileMappings" jsonb not null default '[]'::jsonb,
    "publishedAt" timestamptz not null,
    "activatedAt" timestamptz,
    "deactivatedAt" timestamptz,
    "createdAt" timestamptz not null,
    unique ("definitionId", version),
    check ("deactivatedAt" is null or "activatedAt" is not null),
    check ("deactivatedAt" is null or "deactivatedAt" >= "activatedAt")
  )`.execute(db);
  await sql`create unique index onboarding_definition_version_active_uq
    on onboarding_definition_version ("definitionId")
    where "activatedAt" is not null and "deactivatedAt" is null`.execute(db);

  await sql`create table onboarding_assignment (
    id text primary key,
    "userId" text not null references "user"(id) on delete cascade,
    "definitionVersionId" text not null references onboarding_definition_version(id),
    status text not null check (status in ('assigned', 'in_progress', 'completed', 'superseded')),
    source text not null check (source in ('automatic', 'administrator', 'campaign')),
    "assignedAt" timestamptz not null,
    "startedAt" timestamptz,
    "completedAt" timestamptz,
    "supersededAt" timestamptz,
    check ((status = 'completed') = ("completedAt" is not null)),
    check ((status = 'superseded') = ("supersededAt" is not null))
  )`.execute(db);
  await sql`create unique index onboarding_assignment_open_user_uq
    on onboarding_assignment ("userId")
    where status in ('assigned', 'in_progress')`.execute(db);
  await sql`create index onboarding_assignment_user_idx
    on onboarding_assignment ("userId", "assignedAt" desc)`.execute(db);

  await sql`create table onboarding_response (
    id text primary key,
    "assignmentId" text not null unique references onboarding_assignment(id) on delete cascade,
    "surveyVersionId" text not null references survey_version(id),
    answers jsonb not null default '{}'::jsonb,
    "visitedItemIds" jsonb not null default '[]'::jsonb,
    "currentItemId" text,
    "startedAt" timestamptz not null,
    "updatedAt" timestamptz not null,
    "submittedAt" timestamptz,
    "redactedAt" timestamptz
  )`.execute(db);

  await sql`alter table "user"
    add column phone text,
    add column "currentRegionId" text references coordination_region(id),
    add column "profileData" jsonb not null default '{}'::jsonb`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table "user"
    drop column "profileData",
    drop column "currentRegionId",
    drop column phone`.execute(db);
  await sql`drop table onboarding_response`.execute(db);
  await sql`drop table onboarding_assignment`.execute(db);
  await sql`drop table onboarding_definition_version`.execute(db);
  await sql`drop table onboarding_definition`.execute(db);
  await sql`alter table learning_activity
    drop constraint learning_activity_survey_usage_ck,
    drop column "surveyUsage"`.execute(db);
}
