import { sql, type Kysely } from "kysely";

const migrateAccreditations = (source: string) =>
  sql.raw(`
  coalesce((
    select jsonb_agg(
      (entry - 'logoKey' - 'customLogo') ||
      jsonb_build_object(
        'logoAssetId',
        case
          when entry->>'logoKey' like 'accreditation_logo_%'
            then entry->>'logoKey'
          when entry#>>'{customLogo,assetId}' like 'accreditation_logo_%'
            then entry#>>'{customLogo,assetId}'
          else null
        end
      )
    )
    from jsonb_array_elements(coalesce(${source}, '[]'::jsonb)) as entry
  ), '[]'::jsonb)
`);

const rollbackAccreditations = (source: string) =>
  sql.raw(`
  coalesce((
    select jsonb_agg(
      (entry - 'logoAssetId') ||
      jsonb_build_object('logoKey', entry->>'logoAssetId')
    )
    from jsonb_array_elements(coalesce(${source}, '[]'::jsonb)) as entry
  ), '[]'::jsonb)
`);

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`update course_version
    set content = jsonb_set(
      content,
      '{accreditations}',
      ${migrateAccreditations("content->'accreditations'")}
    )
    where content ? 'accreditations'`.execute(db);
  await sql`update event_template_version
    set accreditations = ${migrateAccreditations("accreditations")}`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`update course_version
    set content = jsonb_set(
      content,
      '{accreditations}',
      ${rollbackAccreditations("content->'accreditations'")}
    )
    where content ? 'accreditations'`.execute(db);
  await sql`update event_template_version
    set accreditations = ${rollbackAccreditations("accreditations")}`.execute(
    db,
  );
}
