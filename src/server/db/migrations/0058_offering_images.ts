import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table offering_image_asset (
    id text primary key,
    "displayName" text not null,
    "objectKey" text not null unique,
    "mediaType" text not null,
    "sourceBytes" integer not null,
    sha256 text not null,
    "createdByUserId" text not null references "user"(id) on delete restrict,
    "createdAt" timestamptz not null default now(),
    constraint offering_image_media_type_ck
      check ("mediaType" in ('image/png', 'image/jpeg')),
    constraint offering_image_source_bytes_ck
      check ("sourceBytes" > 0 and "sourceBytes" <= 5242880),
    constraint offering_image_sha256_ck
      check (sha256 ~ '^[a-f0-9]{64}$')
  )`.execute(db);
  await sql`alter table event_template_version
    add column "coverImage" jsonb`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table event_template_version drop column "coverImage"`.execute(
    db,
  );
  await sql`drop table offering_image_asset`.execute(db);
}
