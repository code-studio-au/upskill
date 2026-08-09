import { sql, type Kysely } from "kysely";

const strictAuditGuard = `create or replace function upskill_guard_audit_event_mutation()
returns trigger
language plpgsql
as $$
begin
  if current_setting('upskill.audit_maintenance', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception 'audit_event is append-only';
end;
$$`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `create or replace function upskill_guard_audit_event_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      if current_setting('upskill.audit_maintenance', true) = 'on' then
        if tg_op = 'DELETE' then
          return old;
        end if;
        return new;
      end if;
      if tg_op = 'UPDATE'
        and old."actorUserId" is not null
        and new."actorUserId" is null
        and (to_jsonb(new) - 'actorUserId') = (to_jsonb(old) - 'actorUserId') then
        return new;
      end if;
      raise exception 'audit_event is append-only';
    end;
    $$`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(strictAuditGuard).execute(db);
}
