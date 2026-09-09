import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_room_operation
    add column "recordingStartDispatchedAt" timestamptz,
    add constraint event_virtual_room_operation_recording_dispatch_ck check (
      kind = 'start_recording'
      or "recordingStartDispatchedAt" is null
    )`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_virtual_room_operation
    drop constraint event_virtual_room_operation_recording_dispatch_ck,
    drop column "recordingStartDispatchedAt"`.execute(db);
}
