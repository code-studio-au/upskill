import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table onboarding_definition_version
    add column "contactVerificationRequired" boolean not null default false`.execute(
    db,
  );
  await sql`alter table onboarding_assignment
    add column "verificationSkippedAt" timestamptz,
    add constraint onboarding_assignment_verification_skip_ck check (
      "verificationSkippedAt" is null or "completedAt" is not null
    )`.execute(db);
  await sql`alter table "user"
    add column "emailEnabled" boolean not null default true,
    add column "emailVerifiedAt" timestamptz,
    add column "smsEnabled" boolean not null default false,
    add column "smsVerifiedAt" timestamptz`.execute(db);
  await sql`update "user"
    set "emailVerifiedAt" = coalesce("activatedAt", "updatedAt", "createdAt")
    where "emailVerified" = true`.execute(db);
  await sql`alter table "user"
    add constraint user_email_verified_at_ck check (
      "emailVerifiedAt" is null or "emailVerified" = true
    ),
    add constraint user_sms_verified_at_ck check (
      "smsVerifiedAt" is null
      or (phone is not null and phone ~ '^[+][1-9][0-9]{7,14}$')
    )`.execute(db);

  await sql`create table onboarding_contact_verification_challenge (
    id text primary key,
    reference text not null unique,
    "assignmentId" text not null references onboarding_assignment(id) on delete cascade,
    "userId" text not null references "user"(id) on delete cascade,
    channel text not null,
    "destinationDigest" text not null,
    "codeDigest" text not null,
    attempts integer not null default 0,
    "expiresAt" timestamptz not null,
    "consumedAt" timestamptz,
    "createdAt" timestamptz not null default now(),
    constraint onboarding_contact_verification_channel_ck
      check (channel in ('email', 'sms')),
    constraint onboarding_contact_verification_reference_ck
      check (reference ~ '^[A-Za-z0-9_-]{32}$'),
    constraint onboarding_contact_verification_digest_ck check (
      "destinationDigest" ~ '^[A-Za-z0-9_-]{43}$'
      and "codeDigest" ~ '^[A-Za-z0-9_-]{43}$'
    ),
    constraint onboarding_contact_verification_attempts_ck
      check (attempts between 0 and 5),
    constraint onboarding_contact_verification_expiry_ck
      check ("expiresAt" > "createdAt"),
    constraint onboarding_contact_verification_consumed_ck
      check ("consumedAt" is null or "consumedAt" >= "createdAt")
  )`.execute(db);
  await sql`create index onboarding_contact_verification_rate_idx
    on onboarding_contact_verification_challenge
      ("assignmentId", channel, "createdAt" desc)`.execute(db);

  await sql`create table onboarding_email_verification_capture (
    "challengeId" text primary key references onboarding_contact_verification_challenge(id) on delete cascade,
    "recipientEmail" text not null,
    subject text not null,
    "textBody" text not null,
    "htmlBody" text not null,
    "createdAt" timestamptz not null default now()
  )`.execute(db);
  await sql`create table onboarding_sms_verification_capture (
    "challengeId" text primary key references onboarding_contact_verification_challenge(id) on delete cascade,
    "recipientPhone" text not null,
    message text not null,
    "createdAt" timestamptz not null default now(),
    constraint onboarding_sms_verification_capture_phone_ck
      check ("recipientPhone" ~ '^[+][1-9][0-9]{7,14}$')
  )`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table onboarding_sms_verification_capture`.execute(db);
  await sql`drop table onboarding_email_verification_capture`.execute(db);
  await sql`drop table onboarding_contact_verification_challenge`.execute(db);
  await sql`alter table "user"
    drop constraint user_sms_verified_at_ck,
    drop constraint user_email_verified_at_ck,
    drop column "smsVerifiedAt",
    drop column "smsEnabled",
    drop column "emailVerifiedAt",
    drop column "emailEnabled"`.execute(db);
  await sql`alter table onboarding_assignment
    drop constraint onboarding_assignment_verification_skip_ck,
    drop column "verificationSkippedAt"`.execute(db);
  await sql`alter table onboarding_definition_version
    drop column "contactVerificationRequired"`.execute(db);
}
