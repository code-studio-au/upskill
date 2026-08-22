import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table event_prerequisite_recovery_challenge
    add column "deliveryChannel" text not null default 'email',
    add constraint event_prerequisite_recovery_delivery_channel_ck
      check ("deliveryChannel" in ('email', 'sms'))`.execute(db);

  await sql`create table event_prerequisite_sms_capture (
    "challengeId" text primary key references event_prerequisite_recovery_challenge(id) on delete cascade,
    "recipientPhone" text not null,
    message text not null,
    "createdAt" timestamptz not null default now(),
    constraint event_prerequisite_sms_capture_phone_ck
      check ("recipientPhone" ~ '^[+][1-9][0-9]{7,14}$')
  )`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table event_prerequisite_sms_capture`.execute(db);
  await sql`alter table event_prerequisite_recovery_challenge
    drop constraint event_prerequisite_recovery_delivery_channel_ck,
    drop column "deliveryChannel"`.execute(db);
}
