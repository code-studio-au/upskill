import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("learning_activity")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("title", "text", (column) => column.notNull())
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("learning_activity_id_kind_uq", ["id", "kind"])
    .addCheckConstraint(
      "learning_activity_kind_ck",
      sql`kind in ('scorm', 'survey', 'resource')`,
    )
    .execute();

  await db.schema
    .createTable("learning_activity_version")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("activityId", "text", (column) => column.notNull())
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("version", "integer", (column) => column.notNull())
    .addColumn("publishedAt", "timestamptz")
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addForeignKeyConstraint(
      "learning_activity_version_activity_fk",
      ["activityId", "kind"],
      "learning_activity",
      ["id", "kind"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addUniqueConstraint("learning_activity_version_number_uq", [
      "activityId",
      "version",
    ])
    .addUniqueConstraint("learning_activity_version_id_kind_uq", ["id", "kind"])
    .addCheckConstraint("learning_activity_version_number_ck", sql`version > 0`)
    .execute();

  await db.schema
    .createTable("scorm_package_version")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("kind", "text", (column) => column.notNull().defaultTo("scorm"))
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("standard", "text", (column) => column.notNull())
    .addColumn("contentPrefix", "text", (column) => column.notNull())
    .addColumn("launchPath", "text", (column) => column.notNull())
    .addColumn("sha256", "text", (column) => column.notNull())
    .addColumn("manifest", "jsonb", (column) =>
      column.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addForeignKeyConstraint(
      "scorm_package_version_activity_fk",
      ["id", "kind"],
      "learning_activity_version",
      ["id", "kind"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addCheckConstraint(
      "scorm_package_version_values_check",
      sql`kind = 'scorm' and status in ('quarantined', 'processing', 'ready', 'rejected') and standard = 'scorm-1.2' and "contentPrefix" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' and "contentPrefix" not like '%..%' and "launchPath" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' and "launchPath" not like '%..%' and sha256 ~ '^[a-f0-9]{64}$'`,
    )
    .execute();

  await db.schema
    .createTable("scorm_attempt")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("enrollmentId", "text", (column) =>
      column.notNull().references("enrollment.id").onDelete("restrict"),
    )
    .addColumn("modulePosition", "integer", (column) => column.notNull())
    .addColumn("scormPackageVersionId", "text", (column) =>
      column
        .notNull()
        .references("scorm_package_version.id")
        .onDelete("restrict"),
    )
    .addColumn("attemptNumber", "integer", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("lessonStatus", "text", (column) => column.notNull())
    .addColumn("location", "text", (column) => column.notNull().defaultTo(""))
    .addColumn("suspendData", "text", (column) =>
      column.notNull().defaultTo(""),
    )
    .addColumn("scoreRaw", "double precision")
    .addColumn("scoreMin", "double precision")
    .addColumn("scoreMax", "double precision")
    .addColumn("totalTimeSeconds", "integer", (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn("startedAt", "timestamptz")
    .addColumn("lastActivityAt", "timestamptz")
    .addColumn("completedAt", "timestamptz")
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("scorm_attempt_number_uq", [
      "enrollmentId",
      "modulePosition",
      "attemptNumber",
    ])
    .addCheckConstraint(
      "scorm_attempt_values_check",
      sql`"modulePosition" >= 0 and "attemptNumber" > 0 and status in ('not_started', 'in_progress', 'completed', 'abandoned') and "lessonStatus" in ('not_attempted', 'incomplete', 'completed', 'passed', 'failed', 'browsed') and length(location) <= 1000 and length("suspendData") <= 65536 and "totalTimeSeconds" >= 0`,
    )
    .execute();

  await db.schema
    .createIndex("scorm_attempt_enrollment_idx")
    .on("scorm_attempt")
    .columns(["enrollmentId", "modulePosition", "status"])
    .execute();

  await db.schema
    .createTable("scorm_launch_token")
    .addColumn("digest", "text", (column) => column.primaryKey())
    .addColumn("attemptId", "text", (column) =>
      column.notNull().references("scorm_attempt.id").onDelete("cascade"),
    )
    .addColumn("expiresAt", "timestamptz", (column) => column.notNull())
    .addColumn("consumedAt", "timestamptz")
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("scorm_launch_token_attempt_idx")
    .on("scorm_launch_token")
    .columns(["attemptId", "expiresAt"])
    .execute();

  await db.schema
    .createTable("scorm_attempt_session")
    .addColumn("digest", "text", (column) => column.primaryKey())
    .addColumn("attemptId", "text", (column) =>
      column.notNull().references("scorm_attempt.id").onDelete("cascade"),
    )
    .addColumn("expiresAt", "timestamptz", (column) => column.notNull())
    .addColumn("revokedAt", "timestamptz")
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("scorm_attempt_session_attempt_idx")
    .on("scorm_attempt_session")
    .columns(["attemptId", "expiresAt"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "scorm_attempt_session",
    "scorm_launch_token",
    "scorm_attempt",
    "scorm_package_version",
    "learning_activity_version",
    "learning_activity",
  ]) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
