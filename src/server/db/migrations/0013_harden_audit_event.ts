import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table audit_event
    add constraint audit_event_action_known_ck check (
      action in (
        'enrollment.access_code_redeemed',
        'enrollment.purchased',
        'enrollment.scorm_completed',
        'learning.progress_overridden',
        'order.checkout_failed',
        'order.checkout_paid',
        'order.paid_existing_enrollment',
        'scorm.attempt_launch_issued',
        'scorm.package_ready',
        'scorm.package_rejected',
        'scorm.package_uploaded',
        'scorm.package_version_removed'
      )
    )`.execute(db);

  await db.schema
    .createIndex("audit_event_action_created_idx")
    .on("audit_event")
    .columns(["action", "createdAt"])
    .execute();
  await db.schema
    .createIndex("audit_event_subject_created_idx")
    .on("audit_event")
    .columns(["subjectType", "subjectId", "createdAt"])
    .execute();
  await db.schema
    .createIndex("audit_event_actor_created_idx")
    .on("audit_event")
    .columns(["actorUserId", "createdAt"])
    .execute();

  await sql
    .raw(
      `create function upskill_guard_audit_event_mutation()
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
    $$`,
    )
    .execute(db);
  await sql
    .raw(
      `create trigger audit_event_append_only
    before update or delete on audit_event
    for each row execute function upskill_guard_audit_event_mutation()`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger if exists audit_event_append_only on audit_event`.execute(
    db,
  );
  await sql`drop function if exists upskill_guard_audit_event_mutation()`.execute(
    db,
  );
  await db.schema
    .dropIndex("audit_event_actor_created_idx")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("audit_event_subject_created_idx")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("audit_event_action_created_idx")
    .ifExists()
    .execute();
  await sql`alter table audit_event drop constraint if exists audit_event_action_known_ck`.execute(
    db,
  );
}
