import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("order_item")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("orderId", "text", (column) =>
      column.notNull().references("order.id").onDelete("cascade"),
    )
    .addColumn("courseVersionId", "text", (column) =>
      column.notNull().references("course_version.id").onDelete("restrict"),
    )
    .addColumn("quantity", "integer", (column) => column.notNull())
    .addColumn("unitPriceCents", "integer", (column) => column.notNull())
    .addColumn("enrollmentDurationDays", "integer", (column) =>
      column.notNull().defaultTo(365),
    )
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("order_item_course_uq", ["orderId", "courseVersionId"])
    .addCheckConstraint(
      "order_item_values_check",
      sql`quantity > 0 and "unitPriceCents" >= 0 and "enrollmentDurationDays" between 1 and 3650`,
    )
    .execute();

  await db.schema
    .createIndex("order_purchaser_status_idx")
    .on("order")
    .columns(["purchaserUserId", "status", "createdAt"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("order_purchaser_status_idx").ifExists().execute();
  await db.schema.dropTable("order_item").ifExists().execute();
}
