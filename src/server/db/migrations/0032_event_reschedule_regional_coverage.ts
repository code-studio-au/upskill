import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>) {
  await db.schema
    .alterTable("event_occurrence_reschedule_region")
    .addColumn("coverageAction", "text", (column) =>
      column.notNull().defaultTo("retained"),
    )
    .addColumn("registrationDisposition", "text")
    .execute();
  await db.schema
    .alterTable("event_occurrence_reschedule_region")
    .addCheckConstraint(
      "event_reschedule_region_coverage_action_ck",
      sql`"coverageAction" in ('retained', 'added', 'retired')`,
    )
    .execute();
  await db.schema
    .alterTable("event_occurrence_reschedule_region")
    .addCheckConstraint(
      "event_reschedule_region_disposition_ck",
      sql`("coverageAction" = 'retired' and "registrationDisposition" in ('future_only', 'cancel_registrations'))
        or ("coverageAction" <> 'retired' and "registrationDisposition" is null)`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>) {
  await db.schema
    .alterTable("event_occurrence_reschedule_region")
    .dropConstraint("event_reschedule_region_disposition_ck")
    .execute();
  await db.schema
    .alterTable("event_occurrence_reschedule_region")
    .dropConstraint("event_reschedule_region_coverage_action_ck")
    .execute();
  await db.schema
    .alterTable("event_occurrence_reschedule_region")
    .dropColumn("registrationDisposition")
    .dropColumn("coverageAction")
    .execute();
}
