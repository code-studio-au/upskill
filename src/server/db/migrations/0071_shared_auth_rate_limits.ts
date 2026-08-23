import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("rateLimit")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("key", "text", (column) => column.notNull().unique())
    .addColumn("count", "integer", (column) => column.notNull())
    .addColumn("lastRequest", "bigint", (column) => column.notNull())
    .execute();
  await sql`create index "rateLimit_lastRequest_idx" on "rateLimit" ("lastRequest")`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("rateLimit").execute();
}
