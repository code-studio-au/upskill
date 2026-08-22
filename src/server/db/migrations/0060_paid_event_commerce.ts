import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table event_occurrence
    drop constraint event_occurrence_registration_mode_ck,
    add constraint event_occurrence_registration_mode_ck
      check ("registrationMode" in (
        'open_entry', 'paid_entry', 'required_unrestricted', 'required_restricted'
      )),
    add column "priceCents" integer,
    add column "salePriceCents" integer,
    add column currency text not null default 'AUD',
    add column "bulkPricing" jsonb not null
      default '{"enabled":false,"tiers":[]}'::jsonb,
    add column "listInStore" boolean not null default false,
    add column featured boolean not null default false,
    add constraint event_occurrence_paid_pricing_ck check (
      (
        "registrationMode" = 'paid_entry'
        and "priceCents" is not null
        and "priceCents" > 0
        and ("salePriceCents" is null or (
          "salePriceCents" > 0 and "salePriceCents" < "priceCents"
        ))
      ) or (
        "registrationMode" <> 'paid_entry'
        and "priceCents" is null
        and "salePriceCents" is null
      )
    ),
    add constraint event_occurrence_currency_ck check (currency = 'AUD'),
    add constraint event_occurrence_bulk_pricing_shape_ck check (
      jsonb_typeof("bulkPricing") = 'object'
      and jsonb_typeof("bulkPricing" -> 'enabled') = 'boolean'
      and jsonb_typeof("bulkPricing" -> 'tiers') = 'array'
      and jsonb_array_length("bulkPricing" -> 'tiers') <= 20
    )`.execute(db);

  await sql`alter table "order"
    drop constraint order_kind_ck,
    add constraint order_kind_ck check (kind in (
      'individual_purchase', 'bulk_purchase', 'capacity_extension',
      'event_registration'
    ))`.execute(db);

  await sql`alter table order_item
    alter column "courseVersionId" drop not null,
    alter column "enrollmentDurationDays" drop not null,
    add column "eventOccurrenceId" text references event_occurrence(id)
      on delete restrict,
    add constraint order_item_target_ck check (
      num_nonnulls("courseVersionId", "eventOccurrenceId") = 1
    ),
    add constraint order_item_duration_ck check (
      ("courseVersionId" is not null and "enrollmentDurationDays" between 1 and 3650)
      or ("eventOccurrenceId" is not null and "enrollmentDurationDays" is null)
    )`.execute(db);
  await sql`alter table order_item drop constraint order_item_values_check`.execute(
    db,
  );
  await sql`alter table order_item add constraint order_item_values_check
    check (quantity > 0 and "unitPriceCents" >= 0)`.execute(db);
  await sql`create unique index order_item_event_uq
    on order_item ("orderId", "eventOccurrenceId")
    where "eventOccurrenceId" is not null`.execute(db);

  await sql`alter table access_grant
    alter column "courseVersionId" drop not null,
    alter column "enrollmentDurationDays" drop not null,
    add column "eventOccurrenceId" text references event_occurrence(id)
      on delete restrict,
    add constraint access_grant_target_ck check (
      num_nonnulls("courseVersionId", "eventOccurrenceId") = 1
    ),
    add constraint access_grant_duration_ck check (
      ("courseVersionId" is not null and "enrollmentDurationDays" between 1 and 3650)
      or ("eventOccurrenceId" is not null and "enrollmentDurationDays" is null)
    )`.execute(db);
  await sql`alter table access_grant drop constraint access_grant_duration_check`.execute(
    db,
  );
  await sql`create index access_grant_event_occurrence_idx
    on access_grant ("eventOccurrenceId", "createdAt")
    where "eventOccurrenceId" is not null`.execute(db);

  await sql`alter table event_registration
    drop constraint event_registration_source_ck,
    add constraint event_registration_source_ck check (source in (
      'ordinary', 'paid_checkout', 'access_code', 'late_invitation',
      'administrator_override'
    )),
    drop constraint event_registration_eligibility_ck,
    add constraint event_registration_eligibility_ck check ("eligibilitySource" in (
      'unrestricted', 'paid', 'access_code', 'verified_domain',
      'administrator_override'
    ))`.execute(db);

  await sql`create table event_access_redemption (
    id text primary key,
    "accessGrantId" text not null references access_grant(id) on delete restrict,
    "accessGrantCodeId" text references access_grant_code(id) on delete restrict,
    "eventRegistrationId" text not null unique references event_registration(id)
      on delete restrict,
    "eventParticipationId" text not null unique references event_participation(id)
      on delete restrict,
    "userId" text not null references "user"(id) on delete restrict,
    "redemptionEmailSnapshot" text not null,
    "informationReleaseNoticeVersion" text not null,
    "informationReleaseAcceptedAt" timestamptz not null,
    "redeemedAt" timestamptz not null default now()
  )`.execute(db);
  await sql`create unique index event_access_redemption_code_uq
    on event_access_redemption ("accessGrantCodeId")
    where "accessGrantCodeId" is not null`.execute(db);

  await sql`create index event_occurrence_catalogue_idx
    on event_occurrence ("listInStore", featured, "startsAt")
    where status = 'published'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index event_occurrence_catalogue_idx`.execute(db);
  await sql`drop table event_access_redemption`.execute(db);
  await sql`alter table event_registration
    drop constraint event_registration_eligibility_ck,
    add constraint event_registration_eligibility_ck check ("eligibilitySource" in (
      'unrestricted', 'verified_domain', 'administrator_override'
    )),
    drop constraint event_registration_source_ck,
    add constraint event_registration_source_ck check (source in (
      'ordinary', 'late_invitation', 'administrator_override'
    ))`.execute(db);
  await sql`drop index access_grant_event_occurrence_idx`.execute(db);
  await sql`alter table access_grant
    drop constraint access_grant_duration_ck,
    drop constraint access_grant_target_ck,
    drop column "eventOccurrenceId",
    alter column "enrollmentDurationDays" set not null,
    alter column "courseVersionId" set not null,
    add constraint access_grant_duration_check
      check ("enrollmentDurationDays" between 1 and 3650)`.execute(db);
  await sql`drop index order_item_event_uq`.execute(db);
  await sql`alter table order_item
    drop constraint order_item_duration_ck,
    drop constraint order_item_target_ck,
    drop constraint order_item_values_check,
    drop column "eventOccurrenceId",
    alter column "enrollmentDurationDays" set not null,
    alter column "courseVersionId" set not null,
    add constraint order_item_values_check check (
      quantity > 0 and "unitPriceCents" >= 0
      and "enrollmentDurationDays" between 1 and 3650
    )`.execute(db);
  await sql`alter table "order"
    drop constraint order_kind_ck,
    add constraint order_kind_ck check (kind in (
      'individual_purchase', 'bulk_purchase', 'capacity_extension'
    ))`.execute(db);
  await sql`alter table event_occurrence
    drop constraint event_occurrence_bulk_pricing_shape_ck,
    drop constraint event_occurrence_currency_ck,
    drop constraint event_occurrence_paid_pricing_ck,
    drop column featured,
    drop column "listInStore",
    drop column "bulkPricing",
    drop column currency,
    drop column "salePriceCents",
    drop column "priceCents",
    drop constraint event_occurrence_registration_mode_ck,
    add constraint event_occurrence_registration_mode_ck check (
      "registrationMode" in (
        'open_entry', 'required_unrestricted', 'required_restricted'
      )
    )`.execute(db);
}
