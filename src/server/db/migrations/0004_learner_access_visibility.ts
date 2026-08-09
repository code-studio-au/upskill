import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("enrollment")
    .addColumn("expiresAt", "timestamptz")
    .addColumn("removedAt", "timestamptz")
    .execute();

  await db.schema
    .createIndex("enrollment_user_status_idx")
    .on("enrollment")
    .columns(["userId", "status", "expiresAt"])
    .execute();

  await db.schema
    .createTable("access_grant_domain")
    .addColumn("accessGrantId", "text", (column) =>
      column.notNull().references("access_grant.id").onDelete("cascade"),
    )
    .addColumn("domain", "text", (column) => column.notNull())
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("access_grant_domain_pk", [
      "accessGrantId",
      "domain",
    ])
    .addCheckConstraint(
      "access_grant_domain_normalized_check",
      sql`domain = lower(domain) and domain ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'`,
    )
    .execute();

  await db.schema
    .createIndex("access_grant_domain_lookup_idx")
    .on("access_grant_domain")
    .column("domain")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("access_grant_domain_lookup_idx")
    .ifExists()
    .execute();
  await db.schema.dropTable("access_grant_domain").ifExists().execute();
  await db.schema.dropIndex("enrollment_user_status_idx").ifExists().execute();
  await db.schema
    .alterTable("enrollment")
    .dropColumn("removedAt")
    .dropColumn("expiresAt")
    .execute();
}
