import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`create table event_virtual_presenter_credential_reservation (
    "roomId" text not null,
    "userId" text not null,
    "credentialExpiresAt" timestamptz not null,
    "firstTokenIssuedAt" timestamptz not null,
    "lastTokenIssuedAt" timestamptz not null,
    primary key ("roomId", "userId"),
    constraint event_virtual_presenter_reservation_room_fk foreign key (
      "roomId"
    ) references event_virtual_room(id) on delete restrict,
    constraint event_virtual_presenter_reservation_user_fk foreign key (
      "userId"
    ) references "user"(id) on delete restrict,
    constraint event_virtual_presenter_reservation_timeline_ck check (
      "firstTokenIssuedAt" <= "lastTokenIssuedAt"
      and "credentialExpiresAt" > "lastTokenIssuedAt"
    )
  )`.execute(db);
  await sql`create index event_virtual_presenter_reservation_active_idx
    on event_virtual_presenter_credential_reservation (
      "roomId", "credentialExpiresAt"
    )`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop table event_virtual_presenter_credential_reservation`.execute(
    db,
  );
}
