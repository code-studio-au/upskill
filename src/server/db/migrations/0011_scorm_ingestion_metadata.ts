import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("scorm_package_version")
    .addColumn("sourceBytes", "integer")
    .addColumn("failureCode", "text")
    .addColumn("processedAt", "timestamptz")
    .execute();
  await db.schema
    .alterTable("scorm_package_version")
    .addCheckConstraint(
      "scorm_package_version_ingestion_check",
      sql`(
        "sourceBytes" is null
        or "sourceBytes" between 1 and 262144000
      ) and (
        "failureCode" is null
        or "failureCode" ~ '^[a-z][a-z0-9_]{2,63}$'
      )`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("scorm_package_version")
    .dropConstraint("scorm_package_version_ingestion_check")
    .execute();
  await db.schema
    .alterTable("scorm_package_version")
    .dropColumn("processedAt")
    .dropColumn("failureCode")
    .dropColumn("sourceBytes")
    .execute();
}
