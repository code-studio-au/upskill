import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_room_operation
    add column "recordingStopDispatchedAt" timestamptz,
    add constraint event_virtual_room_operation_recording_stop_dispatch_ck check (
      kind = 'stop_recording'
      or "recordingStopDispatchedAt" is null
    )`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_room_operation
    drop constraint event_virtual_room_operation_recording_stop_dispatch_ck,
    drop column "recordingStopDispatchedAt"`.execute(db);
}
