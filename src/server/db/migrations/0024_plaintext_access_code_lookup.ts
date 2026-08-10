import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create unique index access_grant_access_code_normalized_uq
    on access_grant ((upper(replace("accessCode", '-', ''))))
    where "accessCode" is not null
  `.execute(db);
  await sql`drop index if exists access_grant_code_digest_uq`.execute(db);
  await db.schema
    .alterTable("access_grant")
    .dropConstraint("access_grant_code_digest_check")
    .execute();
  await db.schema
    .alterTable("access_grant")
    .dropColumn("accessCodeDigest")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("access_grant")
    .addColumn("accessCodeDigest", "text")
    .execute();
  await db.schema
    .alterTable("access_grant")
    .addCheckConstraint(
      "access_grant_code_digest_check",
      sql`"accessCodeDigest" is null or "accessCodeDigest" ~ '^[0-9a-f]{64}$'`,
    )
    .execute();
  await sql`
    create unique index access_grant_code_digest_uq
    on access_grant ("accessCodeDigest")
    where "accessCodeDigest" is not null
  `.execute(db);
  await sql`drop index if exists access_grant_access_code_normalized_uq`.execute(
    db,
  );
}
