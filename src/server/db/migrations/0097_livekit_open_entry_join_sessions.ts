import { sql, type Kysely } from "kysely";

const newAuditActions = ["event_virtual_lobby.guest_access_issued"] as const;

function values(items: ReadonlyArray<string>): string {
  return items.map((item) => `''${item}''`).join(", ");
}

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table event_guest_access
    add constraint event_guest_access_id_occurrence_uq
    unique (id, "eventOccurrenceId")`.execute(db);
  await sql`alter table event_virtual_join_session
    alter column "challengeId" drop not null,
    add column "eventGuestAccessId" text,
    add constraint event_virtual_join_session_guest_access_fk foreign key (
      "eventGuestAccessId", "eventOccurrenceId"
    ) references event_guest_access (id, "eventOccurrenceId") on delete restrict,
    drop constraint event_virtual_join_session_method_ck,
    add constraint event_virtual_join_session_method_ck check (
      (
        "accessMethod" in ('email', 'sms')
        and "challengeId" is not null
        and "eventGuestAccessId" is null
      )
      or (
        "accessMethod" = 'guest'
        and "challengeId" is null
        and "eventGuestAccessId" is not null
      )
    )`.execute(db);
  await sql`alter table event_virtual_lobby_entry
    drop constraint event_virtual_lobby_entry_access_method_ck,
    add constraint event_virtual_lobby_entry_access_method_ck check (
      "accessMethod" in ('authenticated', 'email', 'sms', 'guest')
    )`.execute(db);
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
  await sql`delete from event_virtual_join_session
    where "eventGuestAccessId" is not null`.execute(db);
  await sql`alter table event_virtual_join_session
    drop constraint event_virtual_join_session_method_ck,
    drop constraint event_virtual_join_session_guest_access_fk,
    drop column "eventGuestAccessId",
    alter column "challengeId" set not null,
    add constraint event_virtual_join_session_method_ck check (
      "accessMethod" in ('email', 'sms')
    )`.execute(db);
  await sql`alter table event_guest_access
    drop constraint event_guest_access_id_occurrence_uq`.execute(db);
  // Retained lobby and audit evidence may use the guest method/action. Keep
  // those expanded constraints during rollback rather than rewriting history.
}
