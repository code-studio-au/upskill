import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`create table event_virtual_recovery_delivery (
    "challengeId" text primary key
      references event_virtual_recovery_challenge(id) on delete cascade,
    "recipientAddress" text not null,
    "encryptedCode" text not null,
    "createdAt" timestamptz not null,
    constraint event_virtual_recovery_delivery_recipient_ck check (
      char_length("recipientAddress") between 3 and 320
      and "recipientAddress" !~ '[\\r\\n]'
    ),
    constraint event_virtual_recovery_delivery_envelope_ck check (
      "encryptedCode" ~ '^v1\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{22}$'
    )
  )`.execute(db);
  await sql`create index event_virtual_recovery_delivery_pending_idx
    on event_virtual_recovery_challenge ("createdAt", id)
    where "deliveryStatus" = 'pending'`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop index event_virtual_recovery_delivery_pending_idx`.execute(db);
  await sql`drop table event_virtual_recovery_delivery`.execute(db);
}
