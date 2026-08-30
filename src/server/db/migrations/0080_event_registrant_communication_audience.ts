import { sql, type Kysely } from "kysely";

const audiences = [
  "affected_learner",
  "active_registrants",
  "confirmed_participants",
  "presenters",
  "coordinators",
  "administrators",
] as const;

function values(items: ReadonlyArray<string>): string {
  return items.map((item) => `'${item}'`).join(", ");
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table event_template_version_communication
    drop constraint event_template_communication_audience_ck`.execute(db);
  await sql
    .raw(
      `alter table event_template_version_communication
       add constraint event_template_communication_audience_ck
       check (audience in (${values(audiences)}))`,
    )
    .execute(db);

  await sql`alter table event_occurrence_communication_revision
    drop constraint event_occurrence_communication_audience_ck`.execute(db);
  await sql
    .raw(
      `alter table event_occurrence_communication_revision
       add constraint event_occurrence_communication_audience_ck
       check (audience in (${values(audiences)}))`,
    )
    .execute(db);
}

export async function down(): Promise<void> {
  // Retained communication plans may use the current-registrants audience, so
  // the expanded constraints must survive an application rollback.
}
