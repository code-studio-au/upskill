import { type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createIndex("event_virtual_connection_interval_report_idx")
    .on("event_virtual_connection_interval")
    .columns([
      "eventOccurrenceId",
      "eventSessionId",
      "eventParticipationId",
      "joinedAt",
    ])
    .execute();
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await db.schema
    .dropIndex("event_virtual_connection_interval_report_idx")
    .execute();
}
