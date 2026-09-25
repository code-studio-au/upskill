import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table offline_learning_entitlement
    add column "signedEnvelope" jsonb,
    add constraint offline_learning_entitlement_signed_envelope_ck check (
      "signedEnvelope" is null
      or (
        jsonb_typeof("signedEnvelope") = 'object'
        and "signedEnvelope" ->> 'schemaVersion' = '1'
        and "signedEnvelope" ->> 'algorithm' = 'ecdsa-p256-sha256'
        and "signedEnvelope" ->> 'signingKeyId'
          ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
        and "signedEnvelope" ->> 'signature' ~ '^[A-Za-z0-9_-]{86}$'
        and jsonb_typeof("signedEnvelope" -> 'entitlement') = 'object'
        and "signedEnvelope" #>> '{entitlement,schemaVersion}' = '1'
        and "signedEnvelope" #>> '{entitlement,entitlementId}' = id
        and "signedEnvelope" #>> '{entitlement,attemptId}' = "attemptId"
        and "signedEnvelope" #>> '{entitlement,installationId}' =
          "installationId"
        and "signedEnvelope" #>> '{entitlement,learnerId}' = "userId"
        and "signedEnvelope" #>> '{entitlement,packageVersionId}' =
          "scormPackageVersionId"
        and "signedEnvelope" #>> '{entitlement,packageSha256}' =
          "packageSha256"
        and "signedEnvelope" #>> '{entitlement,runtimeVersion}' =
          "runtimeVersion"
        and ("signedEnvelope" #>> '{entitlement,historyBaseRevision}')::integer
          = "historyBaseRevision"
      )
    )`.execute(db);

  await sql`create function guard_offline_learning_entitlement_signed_envelope()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'UPDATE'
        and new."signedEnvelope" is distinct from old."signedEnvelope" then
        raise exception 'Offline signed entitlement evidence is immutable'
          using errcode = '23514';
      end if;
      return new;
    end
    $$`.execute(db);
  await sql`create trigger offline_learning_entitlement_signed_envelope_guard_trg
    before update on offline_learning_entitlement
    for each row execute function
      guard_offline_learning_entitlement_signed_envelope()`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop trigger offline_learning_entitlement_signed_envelope_guard_trg
    on offline_learning_entitlement`.execute(db);
  await sql`drop function
    guard_offline_learning_entitlement_signed_envelope()`.execute(db);
  await sql`alter table offline_learning_entitlement
    drop constraint offline_learning_entitlement_signed_envelope_ck,
    drop column "signedEnvelope"`.execute(db);
}
