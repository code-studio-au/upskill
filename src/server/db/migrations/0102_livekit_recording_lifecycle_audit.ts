import { sql, type Kysely } from "kysely";

const newAuditActions = [
  "event_virtual_recording.completed",
  "event_virtual_recording.failed",
  "event_virtual_recording.requested",
  "event_virtual_recording.started",
  "event_virtual_recording.stop_requested",
  "event_virtual_recording.stop_started",
] as const;

function values(items: ReadonlyArray<string>): string {
  return items.map((item) => `''${item}''`).join(", ");
}

export async function up<Database>(db: Kysely<Database>): Promise<void> {
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

export function down<Database>(db: Kysely<Database>): Promise<void> {
  void db;
  // Retained recording audit evidence may use these actions. Keep the expanded
  // constraint during rollback so immutable history remains valid.
  return Promise.resolve();
}
