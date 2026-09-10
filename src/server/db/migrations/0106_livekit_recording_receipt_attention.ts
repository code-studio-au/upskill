import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`create index livekit_webhook_receipt_recording_attention_idx
    on livekit_webhook_receipt (
      "matchedRecordingId", "processingState", "receivedAt"
    )
    where "matchedRecordingId" is not null
      and "processingState" in ('pending', 'processing', 'failed')`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop index livekit_webhook_receipt_recording_attention_idx`.execute(
    db,
  );
}
