import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("platform_admin")
    .addColumn("userId", "text", (column) =>
      column.primaryKey().references("user.id").onDelete("restrict"),
    )
    .addColumn("grantedByUserId", "text", (column) =>
      column.references("user.id").onDelete("set null"),
    )
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("platform_admin").ifExists().execute();
}
