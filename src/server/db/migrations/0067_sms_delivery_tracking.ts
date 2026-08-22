import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table sms_delivery (
    id text primary key,
    purpose text not null,
    "recipientPhone" text not null,
    provider text not null,
    "providerBatchId" text,
    status text not null default 'pending',
    "lastErrorCode" text,
    "acceptedAt" timestamptz,
    "sentAt" timestamptz,
    "deliveredAt" timestamptz,
    "failedAt" timestamptz,
    "createdAt" timestamptz not null default now(),
    "updatedAt" timestamptz not null default now(),
    constraint sms_delivery_purpose_ck check (
      purpose in ('event_prerequisite_recovery', 'onboarding_contact_verification')
    ),
    constraint sms_delivery_phone_ck
      check ("recipientPhone" ~ '^[+][1-9][0-9]{7,14}$'),
    constraint sms_delivery_provider_ck
      check (provider in ('local_capture', 'textbee')),
    constraint sms_delivery_status_ck check (
      status in ('pending', 'accepted', 'sent', 'delivered', 'failed', 'unknown')
    ),
    constraint sms_delivery_error_code_ck check (
      "lastErrorCode" is null or "lastErrorCode" ~ '^[A-Za-z0-9_.:-]{1,100}$'
    ),
    constraint sms_delivery_timeline_ck check (
      "updatedAt" >= "createdAt"
      and ("acceptedAt" is null or "acceptedAt" >= "createdAt")
      and ("sentAt" is null or "sentAt" >= "createdAt")
      and ("deliveredAt" is null or "deliveredAt" >= "createdAt")
      and ("failedAt" is null or "failedAt" >= "createdAt")
    )
  )`.execute(db);
  await sql`create unique index sms_delivery_provider_batch_uq
    on sms_delivery (provider, "providerBatchId")
    where "providerBatchId" is not null`.execute(db);
  await sql`create index sms_delivery_operations_idx
    on sms_delivery ("createdAt" desc, id desc)`.execute(db);

  await sql`create table sms_delivery_webhook_event (
    id text primary key,
    "providerEventId" text,
    "eventType" text not null,
    "providerBatchId" text,
    "matchedDeliveryId" text references sms_delivery(id) on delete set null,
    "payloadDigest" text not null,
    "receivedAt" timestamptz not null default now(),
    constraint sms_delivery_webhook_event_type_ck check (
      "eventType" in (
        'MESSAGE_SENT',
        'MESSAGE_DELIVERED',
        'MESSAGE_FAILED',
        'UNKNOWN_STATE',
        'SMS_STATUS_UPDATED'
      )
    ),
    constraint sms_delivery_webhook_digest_ck
      check ("payloadDigest" ~ '^[a-f0-9]{64}$')
  )`.execute(db);
  await sql`create index sms_delivery_webhook_batch_idx
    on sms_delivery_webhook_event ("providerBatchId", "receivedAt" desc)
    where "providerBatchId" is not null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table sms_delivery_webhook_event`.execute(db);
  await sql`drop table sms_delivery`.execute(db);
}
