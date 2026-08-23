import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table notification
    drop constraint notification_delivery_state_ck,
    drop constraint notification_status_ck`.execute(db);
  await sql`alter table notification
    add constraint notification_status_ck check (status in ('pending', 'processing', 'delivered', 'failed', 'superseded', 'unknown')),
    add constraint notification_delivery_state_ck check (
      (status = 'delivered' and "deliveredAt" is not null and "supersededAt" is null)
      or (status = 'superseded' and "deliveredAt" is null and "supersededAt" is not null)
      or (status in ('pending', 'processing', 'failed', 'unknown') and "deliveredAt" is null and "supersededAt" is null)
    )`.execute(db);
  await sql`alter table notification_delivery_attempt
    drop constraint notification_delivery_attempt_result_ck,
    drop constraint notification_delivery_attempt_status_ck`.execute(db);
  await sql`alter table notification_delivery_attempt
    add constraint notification_delivery_attempt_status_ck check (status in ('delivered', 'failed', 'unknown')),
    add constraint notification_delivery_attempt_result_ck check (
      (status = 'delivered' and "providerMessageId" is not null and "errorCode" is null)
      or (status = 'failed' and "providerMessageId" is null and "errorCode" is not null)
      or (status = 'unknown' and "errorCode" is not null)
    )`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`update notification set status = 'failed', "lastErrorCode" = coalesce("lastErrorCode", 'EMAIL_DELIVERY_UNKNOWN') where status = 'unknown'`.execute(
    db,
  );
  await sql`update notification_delivery_attempt set status = 'failed', "providerMessageId" = null where status = 'unknown'`.execute(
    db,
  );
  await sql`alter table notification_delivery_attempt
    drop constraint notification_delivery_attempt_result_ck,
    drop constraint notification_delivery_attempt_status_ck`.execute(db);
  await sql`alter table notification_delivery_attempt
    add constraint notification_delivery_attempt_status_ck check (status in ('delivered', 'failed')),
    add constraint notification_delivery_attempt_result_ck check (
      (status = 'delivered' and "providerMessageId" is not null and "errorCode" is null)
      or (status = 'failed' and "providerMessageId" is null and "errorCode" is not null)
    )`.execute(db);
  await sql`alter table notification
    drop constraint notification_delivery_state_ck,
    drop constraint notification_status_ck`.execute(db);
  await sql`alter table notification
    add constraint notification_status_ck check (status in ('pending', 'processing', 'delivered', 'failed', 'superseded')),
    add constraint notification_delivery_state_ck check (
      (status = 'delivered' and "deliveredAt" is not null and "supersededAt" is null)
      or (status = 'superseded' and "deliveredAt" is null and "supersededAt" is not null)
      or (status in ('pending', 'processing', 'failed') and "deliveredAt" is null and "supersededAt" is null)
    )`.execute(db);
}
