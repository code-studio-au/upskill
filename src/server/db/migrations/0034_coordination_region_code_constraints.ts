import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`update coordination_region set code = upper(code)`.execute(db);
  await sql`alter table coordination_region
    add constraint coordination_region_code_uppercase_ck
    check (code = upper(code))`.execute(db);
  await sql`create unique index coordination_region_code_unique_uq
    on coordination_region (lower(code))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("coordination_region_code_unique_uq")
    .ifExists()
    .execute();
  await sql`alter table coordination_region
    drop constraint if exists coordination_region_code_uppercase_ck`.execute(
    db,
  );
}
