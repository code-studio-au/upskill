import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`update event_template_version
    set accreditations = '[]'::jsonb
    where jsonb_typeof(accreditations) <> 'array'`.execute(db);
  await sql`alter table event_template_version
    add constraint event_template_version_accreditations_shape_ck
      check (
        jsonb_typeof(accreditations) = 'array'
        and jsonb_array_length(accreditations) <= 5
      ),
    add constraint event_template_version_cover_image_shape_ck
      check (
        "coverImage" is null
        or jsonb_typeof("coverImage") = 'object'
      )`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table event_template_version
    drop constraint event_template_version_cover_image_shape_ck,
    drop constraint event_template_version_accreditations_shape_ck`.execute(db);
}
