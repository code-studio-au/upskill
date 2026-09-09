import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_room_operation
    add column "recordingStopOutcomeUnknownAt" timestamptz,
    add constraint event_virtual_room_operation_recording_stop_outcome_ck check (
      "recordingStopOutcomeUnknownAt" is null
      or (
        kind = 'stop_recording'
        and "recordingStopDispatchedAt" is not null
        and "recordingStopOutcomeUnknownAt" >= "recordingStopDispatchedAt"
      )
    )`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_room_operation
    drop constraint event_virtual_room_operation_recording_stop_outcome_ck,
    drop column "recordingStopOutcomeUnknownAt"`.execute(db);
}
