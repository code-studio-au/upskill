import { sql, type Kysely } from "kysely";

const eventTriggers = [
  "registration_submitted",
  "registration_selected",
  "registration_waitlisted",
  "registration_not_selected",
  "registration_cancelled",
  "event_rescheduled",
  "event_cancelled",
  "prework_incomplete",
  "event_start",
  "event_end",
  "session_start",
  "section_release",
  "event_completed",
] as const;

function values(items: ReadonlyArray<string>): string {
  return items.map((item) => `'${item}'`).join(", ");
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table event_template_version_communication
    drop constraint event_template_communication_trigger_ck`.execute(db);
  await sql
    .raw(
      `alter table event_template_version_communication
       add constraint event_template_communication_trigger_ck
       check (trigger in (${values(eventTriggers)}))`,
    )
    .execute(db);

  await sql`alter table event_occurrence_communication_revision
    drop constraint event_occurrence_communication_trigger_ck`.execute(db);
  await sql
    .raw(
      `alter table event_occurrence_communication_revision
       add constraint event_occurrence_communication_trigger_ck
       check (trigger in (${values(eventTriggers)}))`,
    )
    .execute(db);

  await sql`alter table event_communication_schedule
    drop constraint event_communication_schedule_trigger_ck,
    add constraint event_communication_schedule_trigger_ck
      check (trigger in ('event_start', 'event_end', 'session_start', 'prework_incomplete'))`.execute(
    db,
  );
}

export async function down(): Promise<void> {
  // Communication plans and retained delivery evidence may use the new
  // triggers, so their constraints remain expanded during application rollback.
}
