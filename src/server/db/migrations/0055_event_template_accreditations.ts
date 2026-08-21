import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table accreditation_logo_asset (
    id text primary key,
    "displayName" text not null,
    "objectKey" text not null unique,
    "mediaType" text not null,
    "sourceBytes" integer not null,
    sha256 text not null,
    "createdByUserId" text not null references "user"(id) on delete restrict,
    "createdAt" timestamptz not null default now(),
    constraint accreditation_logo_media_type_ck
      check ("mediaType" in ('image/png', 'image/jpeg')),
    constraint accreditation_logo_source_bytes_ck
      check ("sourceBytes" > 0 and "sourceBytes" <= 2097152),
    constraint accreditation_logo_sha256_ck
      check (sha256 ~ '^[a-f0-9]{64}$')
  )`.execute(db);
  await sql`alter table event_template_version
    add column accreditations jsonb not null default '[]'::jsonb`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table event_template_version
    drop column accreditations`.execute(db);
  await sql`drop table accreditation_logo_asset`.execute(db);
}
