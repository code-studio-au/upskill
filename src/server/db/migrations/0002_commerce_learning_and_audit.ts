import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("order")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("purchaserUserId", "text", (column) =>
      column.references("user.id").onDelete("set null"),
    )
    .addColumn("stripeCheckoutSessionId", "text", (column) => column.unique())
    .addColumn("stripePaymentIntentId", "text")
    .addColumn("status", "text", (column) =>
      column.notNull().defaultTo("pending"),
    )
    .addColumn("currency", "text", (column) => column.notNull())
    .addColumn("totalCents", "integer", (column) => column.notNull())
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "order_status_check",
      sql`status in ('pending', 'paid', 'failed', 'refunded')`,
    )
    .addCheckConstraint("order_total_nonnegative", sql`"totalCents" >= 0`)
    .execute();

  await db.schema
    .createTable("access_grant")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("organizationId", "text", (column) =>
      column.references("organization.id").onDelete("restrict"),
    )
    .addColumn("orderId", "text", (column) =>
      column.references("order.id").onDelete("restrict"),
    )
    .addColumn("courseVersionId", "text", (column) =>
      column.notNull().references("course_version.id").onDelete("restrict"),
    )
    .addColumn("quantity", "integer", (column) => column.notNull())
    .addColumn("redeemed", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("expiresAt", "timestamptz")
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "access_grant_quantity_check",
      sql`quantity > 0 and redeemed >= 0 and redeemed <= quantity`,
    )
    .execute();

  await db.schema
    .createTable("enrollment")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("courseVersionId", "text", (column) =>
      column.notNull().references("course_version.id").onDelete("restrict"),
    )
    .addColumn("accessGrantId", "text", (column) =>
      column.references("access_grant.id").onDelete("restrict"),
    )
    .addColumn("status", "text", (column) =>
      column.notNull().defaultTo("active"),
    )
    .addColumn("enrolledAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("completedAt", "timestamptz")
    .addUniqueConstraint("enrollment_version_user_uq", [
      "userId",
      "courseVersionId",
    ])
    .addCheckConstraint(
      "enrollment_status_check",
      sql`status in ('active', 'completed', 'expired', 'cancelled')`,
    )
    .execute();

  await db.schema
    .createTable("outbox_event")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("topic", "text", (column) => column.notNull())
    .addColumn("aggregateId", "text", (column) => column.notNull())
    .addColumn("payload", "jsonb", (column) => column.notNull())
    .addColumn("attempts", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("availableAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("processedAt", "timestamptz")
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("outbox_pending_idx")
    .on("outbox_event")
    .columns(["processedAt", "availableAt"])
    .execute();

  await db.schema
    .createTable("audit_event")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("actorUserId", "text", (column) =>
      column.references("user.id").onDelete("set null"),
    )
    .addColumn("action", "text", (column) => column.notNull())
    .addColumn("subjectType", "text", (column) => column.notNull())
    .addColumn("subjectId", "text", (column) => column.notNull())
    .addColumn("reason", "text")
    .addColumn("metadata", "jsonb", (column) =>
      column.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "audit_event",
    "outbox_event",
    "enrollment",
    "access_grant",
    "order",
  ]) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
