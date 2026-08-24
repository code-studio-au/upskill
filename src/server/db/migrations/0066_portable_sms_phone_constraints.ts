import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table event_prerequisite_sms_capture
    drop constraint event_prerequisite_sms_capture_phone_ck,
    add constraint event_prerequisite_sms_capture_phone_ck
      check ("recipientPhone" ~ '^[+][1-9][0-9]{7,14}$')`.execute(db);
  await sql`alter table "user"
    drop constraint user_sms_verified_at_ck,
    add constraint user_sms_verified_at_ck check (
      "smsVerifiedAt" is null
      or (phone is not null and phone ~ '^[+][1-9][0-9]{7,14}$')
    )`.execute(db);
  await sql`alter table contact_verification_sms_capture
    drop constraint contact_verification_sms_capture_phone_ck,
    add constraint contact_verification_sms_capture_phone_ck
      check ("recipientPhone" ~ '^[+][1-9][0-9]{7,14}$')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table contact_verification_sms_capture
    drop constraint contact_verification_sms_capture_phone_ck,
    add constraint contact_verification_sms_capture_phone_ck
      check ("recipientPhone" ~ '^\\+[1-9][0-9]{7,14}$')`.execute(db);
  await sql`alter table "user"
    drop constraint user_sms_verified_at_ck,
    add constraint user_sms_verified_at_ck check (
      "smsVerifiedAt" is null
      or (phone is not null and phone ~ '^\\+[1-9][0-9]{7,14}$')
    )`.execute(db);
  await sql`alter table event_prerequisite_sms_capture
    drop constraint event_prerequisite_sms_capture_phone_ck,
    add constraint event_prerequisite_sms_capture_phone_ck
      check ("recipientPhone" ~ '^\\+[1-9][0-9]{7,14}$')`.execute(db);
}
