import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("access_grant")
    .addColumn("accessCodeLookupId", "text")
    .addColumn("encryptedAccessCode", "text")
    .addColumn("enrollmentDurationDays", "integer", (column) =>
      column.notNull().defaultTo(365),
    )
    .execute();
  await db.schema
    .alterTable("access_grant")
    .addCheckConstraint(
      "access_grant_code_lookup_id_ck",
      sql`"accessCodeLookupId" is null or "accessCodeLookupId" ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$'`,
    )
    .execute();
  await db.schema
    .alterTable("access_grant")
    .addCheckConstraint(
      "access_grant_encrypted_code_envelope_ck",
      sql`"encryptedAccessCode" is null or "encryptedAccessCode" ~ '^v1\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{22}$'`,
    )
    .execute();
  await db.schema
    .alterTable("access_grant")
    .addCheckConstraint(
      "access_grant_code_fields_together_ck",
      sql`("accessCodeLookupId" is null) = ("encryptedAccessCode" is null)`,
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
    create unique index access_grant_code_lookup_id_uq
    on access_grant ("accessCodeLookupId")
    where "accessCodeLookupId" is not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index if exists access_grant_code_lookup_id_uq`.execute(db);
  await db.schema
    .alterTable("access_grant")
    .dropConstraint("access_grant_duration_check")
    .execute();
  await db.schema
    .alterTable("access_grant")
    .dropConstraint("access_grant_code_fields_together_ck")
    .execute();
  await db.schema
    .alterTable("access_grant")
    .dropConstraint("access_grant_encrypted_code_envelope_ck")
    .execute();
  await db.schema
    .alterTable("access_grant")
    .dropConstraint("access_grant_code_lookup_id_ck")
    .execute();
  await db.schema
    .alterTable("access_grant")
    .dropColumn("enrollmentDurationDays")
    .dropColumn("encryptedAccessCode")
    .dropColumn("accessCodeLookupId")
    .execute();
}
