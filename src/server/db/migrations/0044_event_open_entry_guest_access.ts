import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("event_occurrence")
    .addColumn("openEntryAttendanceMode", "text", (column) =>
      column.notNull().defaultTo("checked_in"),
    )
    .execute();
  await db.schema
    .alterTable("event_occurrence")
    .addCheckConstraint(
      "event_occurrence_open_entry_attendance_mode_ck",
      sql`"openEntryAttendanceMode" in ('checked_in', 'attended')`,
    )
    .execute();

  await db.schema
    .alterTable("event_participation")
    .addColumn("privacyAcceptedAt", "timestamptz")
    .addColumn("privacyNoticeVersion", "text")
    .execute();

  await db.schema
    .createTable("event_guest_access")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("eventOccurrenceId", "text", (column) =>
      column.notNull().references("event_occurrence.id").onDelete("cascade"),
    )
    .addColumn("publicReference", "text", (column) => column.notNull())
    .addColumn("generation", "integer", (column) =>
      column.notNull().defaultTo(1),
    )
    .addColumn("createdAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("revokedAt", "timestamptz")
    .addUniqueConstraint("event_guest_access_public_reference_uq", [
      "publicReference",
    ])
    .addUniqueConstraint("event_guest_access_generation_uq", [
      "eventOccurrenceId",
      "generation",
    ])
    .addCheckConstraint(
      "event_guest_access_reference_ck",
      sql`"publicReference" ~ '^[A-Za-z0-9_-]{32}$'`,
    )
    .addCheckConstraint("event_guest_access_generation_ck", sql`generation > 0`)
    .execute();

  await sql`create unique index event_guest_access_active_occurrence_uq
    on event_guest_access ("eventOccurrenceId")
    where "revokedAt" is null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("event_guest_access").ifExists().execute();
  await db.schema
    .alterTable("event_participation")
    .dropColumn("privacyNoticeVersion")
    .dropColumn("privacyAcceptedAt")
    .execute();
  await db.schema
    .alterTable("event_occurrence")
    .dropConstraint("event_occurrence_open_entry_attendance_mode_ck")
    .execute();
  await db.schema
    .alterTable("event_occurrence")
    .dropColumn("openEntryAttendanceMode")
    .execute();
}
