import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop index event_virtual_lobby_entry_active_credential_idx`.execute(
    db,
  );
  await sql`create index event_virtual_lobby_entry_active_credential_idx
    on event_virtual_lobby_entry (
      "eventVirtualJoinAccessId", "credentialExpiresAt"
    )
    where "credentialExpiresAt" is not null`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop index event_virtual_lobby_entry_active_credential_idx`.execute(
    db,
  );
  await sql`create index event_virtual_lobby_entry_active_credential_idx
    on event_virtual_lobby_entry (
      "eventVirtualJoinAccessId", "credentialExpiresAt"
    )
    where state = 'token_issued' and "credentialExpiresAt" is not null`.execute(
    db,
  );
}
