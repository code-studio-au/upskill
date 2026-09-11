import { sql, type Kysely } from "kysely";

const newAuditActions = ["event_virtual_recording.playback_issued"] as const;

function values(items: ReadonlyArray<string>): string {
  return items.map((item) => `''${item}''`).join(", ");
}

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`create table event_virtual_recording_playback_session (
    "recordingId" text not null references event_virtual_recording(id) on delete restrict,
    "userId" text not null references "user"(id) on delete restrict,
    "expiresAt" timestamptz not null,
    "lastUsedAt" timestamptz not null,
    "createdAt" timestamptz not null,
    primary key ("recordingId", "userId"),
    constraint event_virtual_recording_playback_timeline_ck check (
      "createdAt" <= "lastUsedAt" and "lastUsedAt" < "expiresAt"
    )
  )`.execute(db);
  await sql`create index event_virtual_recording_playback_expiry_idx
    on event_virtual_recording_playback_session ("expiresAt")`.execute(db);
  await sql`do $$
    declare current_definition text;
    declare current_expression text;
    begin
      select pg_get_constraintdef(oid)
        into current_definition
        from pg_constraint
        where conrelid = 'audit_event'::regclass
          and conname = 'audit_event_action_known_ck';
      current_expression := regexp_replace(
        current_definition,
        '^CHECK \\((.*)\\)$',
        '\\1'
      );
      execute 'alter table audit_event drop constraint audit_event_action_known_ck';
      execute 'alter table audit_event add constraint audit_event_action_known_ck check (('
        || current_expression
        || ') or action in (${sql.raw(values(newAuditActions))}))';
    end $$`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  // Retained playback-access evidence may use this action. Keep the expanded
  // constraint during rollback so immutable audit history remains valid.
  await sql`drop table event_virtual_recording_playback_session`.execute(db);
}
