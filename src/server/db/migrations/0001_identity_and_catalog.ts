import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("user")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("email", "text", (column) => column.notNull().unique())
    .addColumn("emailVerified", "boolean", (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn("image", "text")
    .addColumn("stripeCustomerId", "text", (column) => column.unique())
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("session")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("expiresAt", "timestamptz", (column) => column.notNull())
    .addColumn("token", "text", (column) => column.notNull().unique())
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (column) => column.notNull())
    .addColumn("ipAddress", "text")
    .addColumn("userAgent", "text")
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("cascade"),
    )
    .execute();

  await db.schema
    .createIndex("session_user_id_idx")
    .on("session")
    .column("userId")
    .execute();

  await db.schema
    .createTable("account")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("accountId", "text", (column) => column.notNull())
    .addColumn("providerId", "text", (column) => column.notNull())
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("accessToken", "text")
    .addColumn("refreshToken", "text")
    .addColumn("idToken", "text")
    .addColumn("accessTokenExpiresAt", "timestamptz")
    .addColumn("refreshTokenExpiresAt", "timestamptz")
    .addColumn("scope", "text")
    .addColumn("password", "text")
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("account_provider_identity_uq", [
      "providerId",
      "accountId",
    ])
    .execute();

  await db.schema
    .createTable("verification")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("identifier", "text", (column) => column.notNull())
    .addColumn("value", "text", (column) => column.notNull())
    .addColumn("expiresAt", "timestamptz", (column) => column.notNull())
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("organization")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("slug", "text", (column) => column.notNull().unique())
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("organization_member")
    .addColumn("organizationId", "text", (column) =>
      column.notNull().references("organization.id").onDelete("cascade"),
    )
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("cascade"),
    )
    .addColumn("role", "text", (column) => column.notNull())
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("organization_member_pk", [
      "organizationId",
      "userId",
    ])
    .addCheckConstraint(
      "organization_member_role_check",
      sql`role in ('owner', 'admin', 'manager', 'learner')`,
    )
    .execute();

  await db.schema
    .createTable("course")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("slug", "text", (column) => column.notNull().unique())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) =>
      column.notNull().defaultTo("draft"),
    )
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "course_status_check",
      sql`status in ('draft', 'published', 'archived')`,
    )
    .execute();

  await db.schema
    .createTable("course_version")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("courseId", "text", (column) =>
      column.notNull().references("course.id").onDelete("restrict"),
    )
    .addColumn("version", "integer", (column) => column.notNull())
    .addColumn("content", "jsonb", (column) => column.notNull())
    .addColumn("publishedAt", "timestamptz")
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("course_version_number_uq", ["courseId", "version"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "course_version",
    "course",
    "organization_member",
    "organization",
    "verification",
    "account",
    "session",
    "user",
  ]) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
