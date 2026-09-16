import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table scorm_attempt
    add column "progressRevision" integer not null default 0,
    add column "writerMode" text not null default 'online',
    add column "credentialGeneration" integer not null default 0,
    add column "offlineEntitlementId" text,
    add constraint scorm_attempt_offline_identity_uq unique (
      id, "scormPackageVersionId"
    ),
    add constraint scorm_attempt_offline_writer_ck check (
      "progressRevision" >= 0
      and "credentialGeneration" >= 0
      and (
        (
          "writerMode" = 'online'
          and "offlineEntitlementId" is null
        )
        or (
          "writerMode" = 'offline'
          and "offlineEntitlementId" is not null
        )
      )
    )`.execute(db);

  await sql`alter table scorm_launch_token
    add column "credentialGeneration" integer not null default 0,
    add constraint scorm_launch_token_generation_ck check (
      "credentialGeneration" >= 0
    )`.execute(db);
  await sql`alter table scorm_attempt_session
    add column "credentialGeneration" integer not null default 0,
    add constraint scorm_attempt_session_generation_ck check (
      "credentialGeneration" >= 0
    )`.execute(db);

  await sql`create table offline_learning_installation (
    id text primary key,
    "userId" text not null references "user"(id) on delete restrict,
    "schemaVersion" integer not null default 1,
    "publicKeyAlgorithm" text not null default 'ecdsa-p256-sha256',
    "publicKeySpki" bytea not null,
    "publicKeySha256" text not null,
    status text not null default 'active',
    "replacementInstallationId" text,
    "registeredAt" timestamptz not null default statement_timestamp(),
    "endedAt" timestamptz,
    "updatedAt" timestamptz not null default statement_timestamp(),
    constraint offline_learning_installation_user_uq unique (id, "userId"),
    constraint offline_learning_installation_replacement_fk foreign key (
      "replacementInstallationId", "userId"
    ) references offline_learning_installation (id, "userId")
      on delete restrict,
    constraint offline_learning_installation_key_uq unique (
      "userId", "publicKeySha256"
    ),
    constraint offline_learning_installation_key_ck check (
      "schemaVersion" = 1
      and "publicKeyAlgorithm" = 'ecdsa-p256-sha256'
      and octet_length("publicKeySpki") between 64 and 256
      and "publicKeySha256" ~ '^[a-f0-9]{64}$'
    ),
    constraint offline_learning_installation_lifecycle_ck check (
      (
        status = 'active'
        and "endedAt" is null
        and "replacementInstallationId" is null
      )
      or (
        status = 'replaced'
        and "endedAt" is not null
      )
      or (
        status = 'revoked'
        and "endedAt" is not null
        and "replacementInstallationId" is null
      )
    ),
    constraint offline_learning_installation_timeline_ck check (
      isfinite("registeredAt")
      and isfinite("updatedAt")
      and ("endedAt" is null or isfinite("endedAt"))
      and "updatedAt" >= "registeredAt"
      and ("endedAt" is null or "endedAt" >= "registeredAt")
      and (
        "replacementInstallationId" is null
        or "replacementInstallationId" <> id
      )
    )
  )`.execute(db);
  await sql`create unique index offline_learning_installation_active_user_uq
    on offline_learning_installation ("userId")
    where status = 'active'`.execute(db);

  await sql`create function guard_offline_learning_installation()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'INSERT' then
        if new.status <> 'active' then
          raise exception 'Offline installations must begin active'
            using errcode = '23514';
        end if;
        return new;
      end if;
      if tg_op = 'DELETE' then
        if current_user in ('upskill_web', 'upskill_worker') then
          raise exception 'Offline installation history cannot be deleted'
            using errcode = '42501';
        end if;
        return old;
      end if;
      if row(
        new.id, new."userId", new."schemaVersion",
        new."publicKeyAlgorithm", new."publicKeySpki",
        new."publicKeySha256", new."registeredAt"
      ) is distinct from row(
        old.id, old."userId", old."schemaVersion",
        old."publicKeyAlgorithm", old."publicKeySpki",
        old."publicKeySha256", old."registeredAt"
      ) then
        raise exception 'Offline installation key identity is immutable'
          using errcode = '23514';
      end if;
      if old.status <> 'active' and not (
        old.status = 'replaced'
        and old."replacementInstallationId" is null
        and new.status = old.status
        and new."endedAt" = old."endedAt"
        and new."replacementInstallationId" is not null
      ) then
        raise exception 'Offline installation lifecycle is terminal'
          using errcode = '23514';
      end if;
      if old.status = 'active' and new.status not in (
        'active', 'replaced', 'revoked'
      ) then
        raise exception 'Offline installation transition is not allowed'
          using errcode = '23514';
      end if;
      return new;
    end
    $$`.execute(db);
  await sql`create trigger offline_learning_installation_guard_trg
    before insert or update or delete on offline_learning_installation
    for each row execute function guard_offline_learning_installation()`.execute(
    db,
  );

  await sql`create table offline_learning_entitlement (
    id text primary key,
    "schemaVersion" integer not null default 1,
    "userId" text not null references "user"(id) on delete restrict,
    "attemptId" text not null,
    "installationId" text not null,
    "scormPackageVersionId" text not null,
    "packageSha256" text not null,
    "runtimeVersion" text not null,
    "historyBaseRevision" integer not null,
    "writerGeneration" integer not null,
    "highestContiguousSequence" integer not null default 0,
    "reconciliationCursorRevision" integer not null,
    status text not null default 'active',
    resolution text,
    "resolvedByUserId" text references "user"(id) on delete restrict,
    "issuedAt" timestamptz not null default statement_timestamp(),
    "intendedLaunchExpiresAt" timestamptz not null,
    "commitAcceptanceDeadline" timestamptz not null,
    "endedAt" timestamptz,
    constraint offline_learning_entitlement_attempt_uq unique (id, "attemptId"),
    constraint offline_learning_entitlement_installation_uq unique (
      id, "installationId", "userId"
    ),
    constraint offline_learning_entitlement_installation_fk foreign key (
      "installationId", "userId"
    ) references offline_learning_installation (id, "userId")
      on delete restrict,
    constraint offline_learning_entitlement_attempt_package_fk foreign key (
      "attemptId", "scormPackageVersionId"
    ) references scorm_attempt (id, "scormPackageVersionId")
      on delete restrict,
    constraint offline_learning_entitlement_identity_ck check (
      "schemaVersion" = 1
      and "packageSha256" ~ '^[a-f0-9]{64}$'
      and char_length("runtimeVersion") between 1 and 100
      and "runtimeVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
      and "historyBaseRevision" >= 0
      and "writerGeneration" > 0
      and "highestContiguousSequence" >= 0
      and "reconciliationCursorRevision" >= "historyBaseRevision"
    ),
    constraint offline_learning_entitlement_deadline_ck check (
      isfinite("issuedAt")
      and isfinite("intendedLaunchExpiresAt")
      and isfinite("commitAcceptanceDeadline")
      and "intendedLaunchExpiresAt" > "issuedAt"
      and "commitAcceptanceDeadline" >= "intendedLaunchExpiresAt"
      and "commitAcceptanceDeadline" <=
        "intendedLaunchExpiresAt" + interval '30 days'
    ),
    constraint offline_learning_entitlement_lifecycle_ck check (
      (
        status = 'active'
        and resolution is null
        and "resolvedByUserId" is null
        and "endedAt" is null
      )
      or (
        status = 'resolved'
        and resolution in (
          'reconciled', 'discarded', 'administrator_resolved'
        )
        and "endedAt" is not null
      )
      or (
        status = 'replaced'
        and resolution = 'device_replaced'
        and "endedAt" is not null
      )
      or (
        status = 'hard_revoked'
        and resolution = 'hard_revoked'
        and "resolvedByUserId" is not null
        and "endedAt" is not null
      )
    ),
    constraint offline_learning_entitlement_timeline_ck check (
      "endedAt" is null
      or (
        isfinite("endedAt")
        and "endedAt" >= "issuedAt"
      )
    )
  )`.execute(db);
  await sql`create unique index offline_learning_entitlement_active_attempt_uq
    on offline_learning_entitlement ("attemptId")
    where status = 'active'`.execute(db);
  await sql`create index offline_learning_entitlement_user_status_idx
    on offline_learning_entitlement (
      "userId", status, "intendedLaunchExpiresAt", id
    )`.execute(db);

  await sql`create function guard_offline_learning_entitlement()
    returns trigger
    language plpgsql
    as $$
    declare
      authoritative_user_id text;
      authoritative_package_sha256 text;
      installation_status text;
    begin
      if tg_op = 'DELETE' then
        if current_user in ('upskill_web', 'upskill_worker') then
          raise exception 'Offline entitlement history cannot be deleted'
            using errcode = '42501';
        end if;
        return old;
      end if;

      select context."userId", package.sha256
        into authoritative_user_id, authoritative_package_sha256
        from scorm_attempt attempt
        inner join scorm_attempt_context context
          on context."attemptId" = attempt.id
        inner join scorm_package_version package
          on package.id = attempt."scormPackageVersionId"
       where attempt.id = new."attemptId"
         and attempt."scormPackageVersionId" = new."scormPackageVersionId";
      if authoritative_user_id is null
        or authoritative_user_id <> new."userId" then
        raise exception 'Offline entitlement learner does not own the attempt'
          using errcode = '23514';
      end if;
      if authoritative_package_sha256 is null
        or authoritative_package_sha256 <> new."packageSha256" then
        raise exception 'Offline entitlement package digest does not match'
          using errcode = '23514';
      end if;

      if tg_op = 'INSERT' then
        select installation.status
          into installation_status
          from offline_learning_installation installation
         where installation.id = new."installationId"
           and installation."userId" = new."userId";
        if installation_status is distinct from 'active' then
          raise exception 'Offline entitlement requires an active installation'
            using errcode = '23514';
        end if;
        if new.status <> 'active'
          or new."highestContiguousSequence" <> 0
          or new."reconciliationCursorRevision" <>
            new."historyBaseRevision" then
          raise exception 'Offline entitlement must begin at its history base'
            using errcode = '23514';
        end if;
        return new;
      end if;

      if row(
        new.id, new."schemaVersion", new."userId", new."attemptId",
        new."installationId", new."scormPackageVersionId",
        new."packageSha256", new."runtimeVersion",
        new."historyBaseRevision", new."writerGeneration",
        new."issuedAt", new."intendedLaunchExpiresAt",
        new."commitAcceptanceDeadline"
      ) is distinct from row(
        old.id, old."schemaVersion", old."userId", old."attemptId",
        old."installationId", old."scormPackageVersionId",
        old."packageSha256", old."runtimeVersion",
        old."historyBaseRevision", old."writerGeneration",
        old."issuedAt", old."intendedLaunchExpiresAt",
        old."commitAcceptanceDeadline"
      ) then
        raise exception 'Offline entitlement authority is immutable'
          using errcode = '23514';
      end if;
      if old.status <> 'active' then
        raise exception 'Offline entitlement lifecycle is terminal'
          using errcode = '23514';
      end if;
      if new."highestContiguousSequence" < old."highestContiguousSequence"
        or new."reconciliationCursorRevision" <
          old."reconciliationCursorRevision" then
        raise exception 'Offline reconciliation cursor cannot regress'
          using errcode = '23514';
      end if;
      return new;
    end
    $$`.execute(db);
  await sql`create trigger offline_learning_entitlement_guard_trg
    before insert or update or delete on offline_learning_entitlement
    for each row execute function guard_offline_learning_entitlement()`.execute(
    db,
  );

  await sql`alter table scorm_attempt
    add constraint scorm_attempt_offline_entitlement_fk foreign key (
      "offlineEntitlementId", id
    ) references offline_learning_entitlement (id, "attemptId")
      on delete restrict`.execute(db);

  await sql`create function guard_scorm_attempt_offline_writer()
    returns trigger
    language plpgsql
    as $$
    declare
      entitlement_status text;
      entitlement_generation integer;
      entitlement_revision integer;
    begin
      if tg_op = 'UPDATE' then
        if new."progressRevision" < old."progressRevision"
          or new."credentialGeneration" < old."credentialGeneration" then
          raise exception 'SCORM attempt revisions cannot regress'
            using errcode = '23514';
        end if;
        if (
          new."writerMode" is distinct from old."writerMode"
          or new."offlineEntitlementId" is distinct from
            old."offlineEntitlementId"
        ) and new."credentialGeneration" <>
          old."credentialGeneration" + 1 then
          raise exception 'SCORM writer transitions must rotate credentials'
            using errcode = '23514';
        end if;
      end if;
      if new."writerMode" = 'offline' then
        select entitlement.status, entitlement."writerGeneration",
               entitlement."reconciliationCursorRevision"
          into entitlement_status, entitlement_generation,
               entitlement_revision
          from offline_learning_entitlement entitlement
         where entitlement.id = new."offlineEntitlementId"
           and entitlement."attemptId" = new.id;
        if entitlement_status is distinct from 'active'
          or entitlement_generation is distinct from
            new."credentialGeneration"
          or entitlement_revision is distinct from new."progressRevision" then
          raise exception 'SCORM offline writer does not match its entitlement'
            using errcode = '23514';
        end if;
      end if;
      return new;
    end
    $$`.execute(db);
  await sql`create trigger scorm_attempt_offline_writer_guard_trg
    before insert or update on scorm_attempt
    for each row execute function guard_scorm_attempt_offline_writer()`.execute(
    db,
  );

  await sql`create table offline_scorm_reconciliation_receipt (
    id text primary key,
    "entitlementId" text not null,
    "attemptId" text not null,
    "commitId" text not null,
    "clientSequence" integer not null,
    "requestFingerprint" text not null,
    outcome text not null,
    "reasonCode" text not null,
    "resultingAttemptRevision" integer,
    "receivedAt" timestamptz not null default statement_timestamp(),
    constraint offline_scorm_reconciliation_receipt_commit_uq unique (
      "entitlementId", "commitId"
    ),
    constraint offline_scorm_reconciliation_receipt_entitlement_fk foreign key (
      "entitlementId", "attemptId"
    ) references offline_learning_entitlement (id, "attemptId")
      on delete restrict,
    constraint offline_scorm_reconciliation_receipt_identity_ck check (
      char_length("commitId") between 1 and 200
      and "commitId" !~ '[[:cntrl:]]'
      and "clientSequence" > 0
      and "requestFingerprint" ~ '^[a-f0-9]{64}$'
      and char_length("reasonCode") between 1 and 100
      and "reasonCode" ~ '^[a-z][a-z0-9_]*$'
      and isfinite("receivedAt")
    ),
    constraint offline_scorm_reconciliation_receipt_outcome_ck check (
      (
        outcome = 'accepted'
        and "reasonCode" = 'accepted'
        and "resultingAttemptRevision" is not null
        and "resultingAttemptRevision" >= 0
      )
      or (
        outcome in ('rejected', 'conflict')
        and "reasonCode" <> 'accepted'
        and "resultingAttemptRevision" is null
      )
    )
  )`.execute(db);
  await sql`create unique index offline_scorm_receipt_accepted_sequence_uq
    on offline_scorm_reconciliation_receipt (
      "entitlementId", "clientSequence"
    ) where outcome = 'accepted'`.execute(db);
  await sql`create index offline_scorm_receipt_attempt_received_idx
    on offline_scorm_reconciliation_receipt (
      "attemptId", "receivedAt", id
    )`.execute(db);

  await sql`create function guard_offline_scorm_reconciliation_receipt()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'UPDATE' then
        raise exception 'Offline reconciliation receipts are immutable'
          using errcode = '23514';
      end if;
      if tg_op = 'DELETE'
        and current_user in ('upskill_web', 'upskill_worker') then
        raise exception 'Offline reconciliation receipts cannot be deleted'
          using errcode = '42501';
      end if;
      if tg_op = 'DELETE' then
        return old;
      end if;
      return new;
    end
    $$`.execute(db);
  await sql`create trigger offline_scorm_reconciliation_receipt_guard_trg
    before update or delete on offline_scorm_reconciliation_receipt
    for each row execute function guard_offline_scorm_reconciliation_receipt()`.execute(
    db,
  );

  await sql`create table offline_scorm_cleanup_inventory (
    id text primary key,
    "entitlementId" text not null,
    "installationId" text not null,
    "userId" text not null,
    "packageSiteOrigin" text not null,
    state text not null default 'pending',
    "clearRequestedAt" timestamptz,
    "clearedAt" timestamptz,
    "cleanupReceiptSha256" text,
    "lastErrorCode" text,
    "createdAt" timestamptz not null default statement_timestamp(),
    "updatedAt" timestamptz not null default statement_timestamp(),
    constraint offline_scorm_cleanup_inventory_entitlement_uq unique (
      "entitlementId"
    ),
    constraint offline_scorm_cleanup_inventory_origin_uq unique (
      "packageSiteOrigin"
    ),
    constraint offline_scorm_cleanup_inventory_entitlement_fk foreign key (
      "entitlementId", "installationId", "userId"
    ) references offline_learning_entitlement (
      id, "installationId", "userId"
    ) on delete restrict,
    constraint offline_scorm_cleanup_inventory_origin_ck check (
      char_length("packageSiteOrigin") between 9 and 2048
      and "packageSiteOrigin" ~
        '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?$'
      and "packageSiteOrigin" !~ '[[:cntrl:]]'
    ),
    constraint offline_scorm_cleanup_inventory_state_ck check (
      (
        state = 'pending'
        and "clearRequestedAt" is null
        and "clearedAt" is null
        and "cleanupReceiptSha256" is null
        and "lastErrorCode" is null
      )
      or (
        state = 'clearing'
        and "clearRequestedAt" is not null
        and "clearedAt" is null
        and "cleanupReceiptSha256" is null
        and "lastErrorCode" is null
      )
      or (
        state = 'needs_attention'
        and "clearRequestedAt" is not null
        and "clearedAt" is null
        and "cleanupReceiptSha256" is null
        and "lastErrorCode" is not null
        and char_length("lastErrorCode") between 1 and 100
        and "lastErrorCode" ~ '^[a-z][a-z0-9_]*$'
      )
      or (
        state = 'cleared'
        and "clearRequestedAt" is not null
        and "clearedAt" is not null
        and "cleanupReceiptSha256" ~ '^[a-f0-9]{64}$'
        and "lastErrorCode" is null
      )
    ),
    constraint offline_scorm_cleanup_inventory_timeline_ck check (
      isfinite("createdAt")
      and isfinite("updatedAt")
      and ("clearRequestedAt" is null or isfinite("clearRequestedAt"))
      and ("clearedAt" is null or isfinite("clearedAt"))
      and "updatedAt" >= "createdAt"
      and (
        "clearRequestedAt" is null
        or "clearRequestedAt" >= "createdAt"
      )
      and (
        "clearedAt" is null
        or "clearedAt" >= "clearRequestedAt"
      )
    )
  )`.execute(db);
  await sql`create index offline_scorm_cleanup_user_state_idx
    on offline_scorm_cleanup_inventory (
      "userId", state, "createdAt", id
    )`.execute(db);

  await sql`create function guard_offline_scorm_cleanup_inventory()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'INSERT' then
        if new.state <> 'pending' then
          raise exception 'Offline cleanup inventory must begin pending'
            using errcode = '23514';
        end if;
        return new;
      end if;
      if tg_op = 'DELETE' then
        if current_user in ('upskill_web', 'upskill_worker') then
          raise exception 'Offline cleanup inventory cannot be deleted'
            using errcode = '42501';
        end if;
        return old;
      end if;
      if row(
        new.id, new."entitlementId", new."installationId",
        new."userId", new."packageSiteOrigin", new."createdAt"
      ) is distinct from row(
        old.id, old."entitlementId", old."installationId",
        old."userId", old."packageSiteOrigin", old."createdAt"
      ) then
        raise exception 'Offline cleanup inventory identity is immutable'
          using errcode = '23514';
      end if;
      if old.state = 'cleared' then
        raise exception 'Cleared offline cleanup evidence is immutable'
          using errcode = '23514';
      end if;
      if not (
        (old.state = 'pending' and new.state in ('pending', 'clearing'))
        or (
          old.state = 'clearing'
          and new.state in ('clearing', 'needs_attention', 'cleared')
        )
        or (
          old.state = 'needs_attention'
          and new.state in ('needs_attention', 'clearing')
        )
      ) then
        raise exception 'Offline cleanup transition is not allowed'
          using errcode = '23514';
      end if;
      return new;
    end
    $$`.execute(db);
  await sql`create trigger offline_scorm_cleanup_inventory_guard_trg
    before insert or update or delete on offline_scorm_cleanup_inventory
    for each row execute function guard_offline_scorm_cleanup_inventory()`.execute(
    db,
  );

  await sql`do $$
    declare
      role_name text;
    begin
      foreach role_name in array array['upskill_web', 'upskill_worker'] loop
        if exists (select 1 from pg_roles where rolname = role_name) then
          execute format(
            'revoke delete on table offline_learning_installation from %I',
            role_name
          );
          execute format(
            'revoke delete on table offline_learning_entitlement from %I',
            role_name
          );
          execute format(
            'revoke update, delete on table offline_scorm_reconciliation_receipt from %I',
            role_name
          );
          execute format(
            'revoke delete on table offline_scorm_cleanup_inventory from %I',
            role_name
          );
        end if;
      end loop;
    end
    $$`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop trigger offline_scorm_cleanup_inventory_guard_trg
    on offline_scorm_cleanup_inventory`.execute(db);
  await sql`drop function guard_offline_scorm_cleanup_inventory()`.execute(db);
  await sql`drop table offline_scorm_cleanup_inventory`.execute(db);

  await sql`drop trigger offline_scorm_reconciliation_receipt_guard_trg
    on offline_scorm_reconciliation_receipt`.execute(db);
  await sql`drop function guard_offline_scorm_reconciliation_receipt()`.execute(
    db,
  );
  await sql`drop table offline_scorm_reconciliation_receipt`.execute(db);

  await sql`drop trigger scorm_attempt_offline_writer_guard_trg
    on scorm_attempt`.execute(db);
  await sql`drop function guard_scorm_attempt_offline_writer()`.execute(db);
  await sql`alter table scorm_attempt
    drop constraint scorm_attempt_offline_entitlement_fk`.execute(db);

  await sql`drop trigger offline_learning_entitlement_guard_trg
    on offline_learning_entitlement`.execute(db);
  await sql`drop function guard_offline_learning_entitlement()`.execute(db);
  await sql`drop table offline_learning_entitlement`.execute(db);

  await sql`drop trigger offline_learning_installation_guard_trg
    on offline_learning_installation`.execute(db);
  await sql`drop function guard_offline_learning_installation()`.execute(db);
  await sql`drop table offline_learning_installation`.execute(db);

  await sql`alter table scorm_attempt_session
    drop constraint scorm_attempt_session_generation_ck,
    drop column "credentialGeneration"`.execute(db);
  await sql`alter table scorm_launch_token
    drop constraint scorm_launch_token_generation_ck,
    drop column "credentialGeneration"`.execute(db);
  await sql`alter table scorm_attempt
    drop constraint scorm_attempt_offline_writer_ck,
    drop constraint scorm_attempt_offline_identity_uq,
    drop column "offlineEntitlementId",
    drop column "credentialGeneration",
    drop column "writerMode",
    drop column "progressRevision"`.execute(db);
}
