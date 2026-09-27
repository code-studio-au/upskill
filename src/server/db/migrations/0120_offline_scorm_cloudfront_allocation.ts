import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`create table offline_scorm_cloudfront_allocation (
    "entitlementId" text primary key,
    "distributionId" text,
    "distributionDomain" text,
    state text not null default 'allocating',
    "recoveryState" text,
    "lastErrorCode" text,
    "allocationStartedAt" timestamptz not null default statement_timestamp(),
    "boundAt" timestamptz,
    "enableRequestedAt" timestamptz,
    "activatedAt" timestamptz,
    "disableRequestedAt" timestamptz,
    "disabledAt" timestamptz,
    "deletionRequestedAt" timestamptz,
    "deletedAt" timestamptz,
    "createdAt" timestamptz not null default statement_timestamp(),
    "updatedAt" timestamptz not null default statement_timestamp(),
    constraint offline_scorm_cloudfront_distribution_id_uq unique (
      "distributionId"
    ),
    constraint offline_scorm_cloudfront_distribution_domain_uq unique (
      "distributionDomain"
    ),
    constraint offline_scorm_cloudfront_allocation_identity_ck check (
      char_length("entitlementId") between 1 and 255
      and "entitlementId" ~ '^[A-Za-z0-9_-]+$'
      and (
        (
          "distributionId" is null
          and "distributionDomain" is null
        )
        or (
          "distributionId" ~ '^[A-Z0-9]{8,32}$'
          and char_length("distributionDomain") between 16 and 253
          and "distributionDomain" ~
            '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.]cloudfront[.]net$'
        )
      )
    ),
    constraint offline_scorm_cloudfront_allocation_error_ck check (
      (
        state = 'needs_attention'
        and "recoveryState" in (
          'allocating', 'enabling', 'disabling', 'deletion_pending'
        )
        and "lastErrorCode" ~ '^[a-z][a-z0-9_]{0,99}$'
      )
      or (
        state <> 'needs_attention'
        and "recoveryState" is null
        and "lastErrorCode" is null
      )
    ),
    constraint offline_scorm_cloudfront_allocation_state_ck check (
      (
        state = 'allocating'
        and "distributionId" is null
        and "boundAt" is null
        and "enableRequestedAt" is null
        and "activatedAt" is null
        and "disableRequestedAt" is null
        and "disabledAt" is null
        and "deletionRequestedAt" is null
        and "deletedAt" is null
      )
      or (
        state = 'binding_pending'
        and "distributionId" is not null
        and "boundAt" is not null
        and "enableRequestedAt" is null
        and "activatedAt" is null
        and "disableRequestedAt" is null
        and "disabledAt" is null
        and "deletionRequestedAt" is null
        and "deletedAt" is null
      )
      or (
        state = 'enabling'
        and "distributionId" is not null
        and "boundAt" is not null
        and "enableRequestedAt" is not null
        and "activatedAt" is null
        and "disableRequestedAt" is null
        and "disabledAt" is null
        and "deletionRequestedAt" is null
        and "deletedAt" is null
      )
      or (
        state = 'active'
        and "distributionId" is not null
        and "boundAt" is not null
        and "enableRequestedAt" is not null
        and "activatedAt" is not null
        and "disableRequestedAt" is null
        and "disabledAt" is null
        and "deletionRequestedAt" is null
        and "deletedAt" is null
      )
      or (
        state = 'disabling'
        and "distributionId" is not null
        and "boundAt" is not null
        and "disableRequestedAt" is not null
        and "disabledAt" is null
        and "deletionRequestedAt" is null
        and "deletedAt" is null
      )
      or (
        state = 'deletion_pending'
        and "distributionId" is not null
        and "boundAt" is not null
        and "disableRequestedAt" is not null
        and "disabledAt" is not null
        and "deletionRequestedAt" is not null
        and "deletedAt" is null
      )
      or (
        state = 'deleted'
        and "distributionId" is not null
        and "boundAt" is not null
        and "disableRequestedAt" is not null
        and "disabledAt" is not null
        and "deletionRequestedAt" is not null
        and "deletedAt" is not null
      )
      or (
        state = 'needs_attention'
        and (
          (
            "recoveryState" = 'allocating'
            and "distributionId" is null
            and "boundAt" is null
            and "enableRequestedAt" is null
            and "activatedAt" is null
            and "disableRequestedAt" is null
            and "disabledAt" is null
            and "deletionRequestedAt" is null
            and "deletedAt" is null
          )
          or (
            "recoveryState" = 'enabling'
            and "distributionId" is not null
            and "boundAt" is not null
            and "enableRequestedAt" is not null
            and "activatedAt" is null
            and "disableRequestedAt" is null
            and "disabledAt" is null
            and "deletionRequestedAt" is null
            and "deletedAt" is null
          )
          or (
            "recoveryState" = 'disabling'
            and "distributionId" is not null
            and "boundAt" is not null
            and "disableRequestedAt" is not null
            and "disabledAt" is null
            and "deletionRequestedAt" is null
            and "deletedAt" is null
          )
          or (
            "recoveryState" = 'deletion_pending'
            and "distributionId" is not null
            and "boundAt" is not null
            and "disableRequestedAt" is not null
            and "disabledAt" is not null
            and "deletionRequestedAt" is not null
            and "deletedAt" is null
          )
        )
      )
    ),
    constraint offline_scorm_cloudfront_allocation_timeline_ck check (
      isfinite("allocationStartedAt")
      and isfinite("createdAt")
      and isfinite("updatedAt")
      and "allocationStartedAt" >= "createdAt"
      and "updatedAt" >= "allocationStartedAt"
      and (
        "boundAt" is null
        or (
          isfinite("boundAt")
          and "boundAt" >= "allocationStartedAt"
          and "updatedAt" >= "boundAt"
        )
      )
      and (
        "enableRequestedAt" is null
        or (
          isfinite("enableRequestedAt")
          and "enableRequestedAt" >= "boundAt"
          and "updatedAt" >= "enableRequestedAt"
        )
      )
      and (
        "activatedAt" is null
        or (
          isfinite("activatedAt")
          and "activatedAt" >= "enableRequestedAt"
          and "updatedAt" >= "activatedAt"
        )
      )
      and (
        "disableRequestedAt" is null
        or (
          isfinite("disableRequestedAt")
          and "disableRequestedAt" >= "boundAt"
          and "updatedAt" >= "disableRequestedAt"
        )
      )
      and (
        "disabledAt" is null
        or (
          isfinite("disabledAt")
          and "disabledAt" >= "disableRequestedAt"
          and "updatedAt" >= "disabledAt"
        )
      )
      and (
        "deletionRequestedAt" is null
        or (
          isfinite("deletionRequestedAt")
          and "deletionRequestedAt" >= "disabledAt"
          and "updatedAt" >= "deletionRequestedAt"
        )
      )
      and (
        "deletedAt" is null
        or (
          isfinite("deletedAt")
          and "deletedAt" >= "deletionRequestedAt"
          and "updatedAt" >= "deletedAt"
        )
      )
    )
  )`.execute(db);

  await sql`create index offline_scorm_cloudfront_allocation_work_idx
    on offline_scorm_cloudfront_allocation (
      state, "updatedAt", "entitlementId"
    ) where state not in ('active', 'deleted')`.execute(db);

  await sql`create function guard_offline_scorm_cloudfront_allocation()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'INSERT' then
        if new.state <> 'allocating' then
          raise exception 'CloudFront allocation must begin allocating'
            using errcode = '23514';
        end if;
        return new;
      end if;

      if tg_op = 'DELETE' then
        if current_user in ('upskill_web', 'upskill_worker') then
          raise exception 'CloudFront allocation evidence cannot be deleted'
            using errcode = '42501';
        end if;
        return old;
      end if;

      if row(
        new."entitlementId", new."allocationStartedAt", new."createdAt"
      ) is distinct from row(
        old."entitlementId", old."allocationStartedAt", old."createdAt"
      ) then
        raise exception 'CloudFront allocation identity is immutable'
          using errcode = '23514';
      end if;

      if old."distributionId" is not null and row(
        new."distributionId", new."distributionDomain"
      ) is distinct from row(
        old."distributionId", old."distributionDomain"
      ) then
        raise exception 'CloudFront distribution binding is immutable'
          using errcode = '23514';
      end if;

      if (
        (old."boundAt" is not null
          and new."boundAt" is distinct from old."boundAt")
        or (old."enableRequestedAt" is not null
          and new."enableRequestedAt" is distinct from old."enableRequestedAt")
        or (old."activatedAt" is not null
          and new."activatedAt" is distinct from old."activatedAt")
        or (old."disableRequestedAt" is not null
          and new."disableRequestedAt" is distinct from old."disableRequestedAt")
        or (old."disabledAt" is not null
          and new."disabledAt" is distinct from old."disabledAt")
        or (old."deletionRequestedAt" is not null
          and new."deletionRequestedAt" is distinct from old."deletionRequestedAt")
        or (old."deletedAt" is not null
          and new."deletedAt" is distinct from old."deletedAt")
      ) then
        raise exception 'CloudFront lifecycle evidence is immutable'
          using errcode = '23514';
      end if;

      if new."updatedAt" < old."updatedAt" then
        raise exception 'CloudFront allocation time cannot move backwards'
          using errcode = '23514';
      end if;

      if (
        (old."boundAt" is null and new."boundAt" is not null
          and not (
            old.state in ('allocating', 'needs_attention')
            and new.state = 'binding_pending'
          ))
        or (old."enableRequestedAt" is null
          and new."enableRequestedAt" is not null
          and not (
            old.state = 'binding_pending'
            and new.state = 'enabling'
          ))
        or (old."activatedAt" is null and new."activatedAt" is not null
          and not (old.state = 'enabling' and new.state = 'active'))
        or (old."disableRequestedAt" is null
          and new."disableRequestedAt" is not null
          and not (
            old.state in ('binding_pending', 'enabling', 'active')
            and new.state = 'disabling'
          ))
        or (old."disabledAt" is null and new."disabledAt" is not null
          and not (
            old.state = 'disabling'
            and new.state = 'deletion_pending'
          ))
        or (old."deletionRequestedAt" is null
          and new."deletionRequestedAt" is not null
          and not (
            old.state = 'disabling'
            and new.state = 'deletion_pending'
          ))
        or (old."deletedAt" is null and new."deletedAt" is not null
          and not (
            old.state = 'deletion_pending'
            and new.state = 'deleted'
          ))
      ) then
        raise exception 'CloudFront lifecycle milestone is out of order'
          using errcode = '23514';
      end if;

      if old.state = 'deleted' and new is distinct from old then
        raise exception 'Deleted CloudFront allocation evidence is immutable'
          using errcode = '23514';
      end if;

      if new.state is distinct from old.state and not (
        (old.state = 'allocating'
          and new.state in ('binding_pending', 'needs_attention'))
        or (old.state = 'binding_pending'
          and new.state in ('enabling', 'disabling'))
        or (old.state = 'enabling'
          and new.state in ('active', 'disabling', 'needs_attention'))
        or (old.state = 'active' and new.state = 'disabling')
        or (old.state = 'disabling'
          and new.state in ('deletion_pending', 'needs_attention'))
        or (old.state = 'deletion_pending'
          and new.state in ('deleted', 'needs_attention'))
        or (
          old.state = 'needs_attention'
          and new.state = old."recoveryState"
        )
      ) then
        raise exception 'CloudFront allocation transition is not allowed'
          using errcode = '23514';
      end if;

      if old.state <> 'needs_attention'
        and new.state = 'needs_attention'
        and new."recoveryState" is distinct from old.state then
        raise exception 'CloudFront recovery state must match failed work'
          using errcode = '23514';
      end if;
      return new;
    end
    $$`.execute(db);

  await sql`create trigger offline_scorm_cloudfront_allocation_guard_trg
    before insert or update or delete on offline_scorm_cloudfront_allocation
    for each row execute function guard_offline_scorm_cloudfront_allocation()`.execute(
    db,
  );

  await sql`do $$
    declare
      role_name text;
    begin
      foreach role_name in array array['upskill_web', 'upskill_worker'] loop
        if exists (select 1 from pg_roles where rolname = role_name) then
          execute format(
            'revoke delete on table offline_scorm_cloudfront_allocation from %I',
            role_name
          );
        end if;
      end loop;
    end
    $$`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop trigger offline_scorm_cloudfront_allocation_guard_trg
    on offline_scorm_cloudfront_allocation`.execute(db);
  await sql`drop function guard_offline_scorm_cloudfront_allocation()`.execute(
    db,
  );
  await sql`drop table offline_scorm_cloudfront_allocation`.execute(db);
}
