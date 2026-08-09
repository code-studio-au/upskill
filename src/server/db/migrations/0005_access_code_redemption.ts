import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("access_grant")
    .addColumn("accessCodeDigest", "text")
    .addColumn("enrollmentDurationDays", "integer", (column) =>
      column.notNull().defaultTo(365),
    )
    .execute();
  await db.schema
    .alterTable("access_grant")
    .addCheckConstraint(
      "access_grant_code_digest_check",
      sql`"accessCodeDigest" is null or "accessCodeDigest" ~ '^[0-9a-f]{64}$'`,
    )
    .execute();
  await db.schema
    .alterTable("access_grant")
    .addCheckConstraint(
      "access_grant_duration_check",
      sql`"enrollmentDurationDays" between 1 and 3650`,
    )
    .execute();

  await sql`
    create unique index access_grant_code_digest_uq
    on access_grant ("accessCodeDigest")
    where "accessCodeDigest" is not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index if exists access_grant_code_digest_uq`.execute(db);
  await db.schema
    .alterTable("access_grant")
    .dropConstraint("access_grant_duration_check")
    .execute();
  await db.schema
    .alterTable("access_grant")
    .dropConstraint("access_grant_code_digest_check")
    .execute();
  await db.schema
    .alterTable("access_grant")
    .dropColumn("enrollmentDurationDays")
    .dropColumn("accessCodeDigest")
    .execute();
}
