import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("access_grant")
    .addColumn("fulfillmentMode", "text")
    .addColumn("codePrefix", "text")
    .execute();
  await sql`drop index if exists access_grant_code_lookup_id_uq`.execute(db);

  await db.schema
    .createTable("access_grant_code")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("accessGrantId", "text", (column) =>
      column.notNull().references("access_grant.id").onDelete("restrict"),
    )
    .addColumn("lookupId", "text", (column) => column.notNull())
    .addColumn("encryptedAccessCode", "text", (column) => column.notNull())
    .addColumn("ordinal", "integer")
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "access_grant_code_lookup_id_ck",
      sql`"lookupId" ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$'`,
    )
    .addCheckConstraint(
      "access_grant_code_envelope_ck",
      sql`"encryptedAccessCode" ~ '^v1\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{22}$'`,
    )
    .addCheckConstraint(
      "access_grant_code_ordinal_ck",
      sql`"ordinal" is null or "ordinal" > 0`,
    )
    .addUniqueConstraint("access_grant_code_lookup_id_uq", ["lookupId"])
    .execute();
  await sql`create unique index access_grant_code_ordinal_uq
    on access_grant_code ("accessGrantId", "ordinal")
    where "ordinal" is not null`.execute(db);
  await sql`create unique index access_grant_shared_code_uq
    on access_grant_code ("accessGrantId")
    where "ordinal" is null`.execute(db);

  await sql`insert into access_grant_code (
      id, "accessGrantId", "lookupId", "encryptedAccessCode", ordinal, "createdAt"
    )
    select
      'access_grant_code_' || id,
      id,
      "accessCodeLookupId",
      "encryptedAccessCode",
      null,
      "createdAt"
    from access_grant
    where "accessCodeLookupId" is not null and "encryptedAccessCode" is not null`.execute(
    db,
  );
  await sql`update access_grant
    set "fulfillmentMode" = 'shared_code'
    where kind in ('bulk_purchase', 'enterprise_contract')`.execute(db);

  await db.schema
    .alterTable("access_grant")
    .addCheckConstraint(
      "access_grant_fulfillment_mode_ck",
      sql`(
        kind = 'individual_purchase' and "fulfillmentMode" is null
      ) or (
        kind in ('bulk_purchase', 'enterprise_contract')
        and "fulfillmentMode" in ('shared_code', 'single_use_codes')
      )`,
    )
    .execute();

  await db.schema
    .alterTable("entitlement")
    .addColumn("originAccessGrantCodeId", "text", (column) =>
      column.references("access_grant_code.id").onDelete("restrict"),
    )
    .execute();
  await db.schema
    .alterTable("entitlement")
    .addCheckConstraint(
      "entitlement_access_grant_code_origin_ck",
      sql`"originAccessGrantCodeId" is null or (
        "originType" = 'access_grant' and "originAccessGrantId" is not null
      )`,
    )
    .execute();
  await db.schema
    .createIndex("entitlement_access_grant_code_uq")
    .unique()
    .on("entitlement")
    .column("originAccessGrantCodeId")
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
    .dropColumn("encryptedAccessCode")
    .execute();
  await db.schema
    .alterTable("access_grant")
    .dropColumn("accessCodeLookupId")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("access_grant")
    .addColumn("accessCodeLookupId", "text")
    .addColumn("encryptedAccessCode", "text")
    .execute();
  await sql`update access_grant
    set
      "accessCodeLookupId" = code."lookupId",
      "encryptedAccessCode" = code."encryptedAccessCode"
    from access_grant_code as code
    where code."accessGrantId" = access_grant.id and code.ordinal is null`.execute(
    db,
  );
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
    .alterTable("entitlement")
    .dropConstraint("entitlement_access_grant_code_origin_ck")
    .execute();
  await db.schema
    .alterTable("entitlement")
    .dropColumn("originAccessGrantCodeId")
    .execute();
  await db.schema.dropTable("access_grant_code").execute();
  await sql`create unique index access_grant_code_lookup_id_uq
    on access_grant ("accessCodeLookupId")
    where "accessCodeLookupId" is not null`.execute(db);
  await db.schema
    .alterTable("access_grant")
    .dropConstraint("access_grant_fulfillment_mode_ck")
    .execute();
  await db.schema.alterTable("access_grant").dropColumn("codePrefix").execute();
  await db.schema
    .alterTable("access_grant")
    .dropColumn("fulfillmentMode")
    .execute();
}
