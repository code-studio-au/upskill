import "@tanstack/react-start/server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { sql, type Transaction } from "kysely";
import {
  EVENT_GUEST_PRIVACY_NOTICE_VERSION,
  type EventGuestAccessResult,
  type EventGuestSubmissionResult,
} from "#/features/event-guest/event-guest.schema";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { provisionUser } from "#/server/identity/provisional-user.server";
import { logServerEvent } from "#/server/logging/server-logger";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { completeEventParticipationIfReady } from "#/server/learning/event-learning-completion.server";

const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const RATE_LIMIT_MAXIMUM = 10;
const rateLimit = new Map<string, { count: number; resetAt: number }>();

function issuePublicReference(): string {
  return randomBytes(24).toString("base64url");
}

function requestFingerprint(publicReference: string): string {
  const headers = getRequestHeaders();
  const address =
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    "unknown";
  return createHash("sha256")
    .update(`${publicReference}:${address}`)
    .digest("base64url");
}

function consumeRateLimit(
  publicReference: string,
  rateLimitKey?: string,
): boolean {
  const now = Date.now();
  if (rateLimit.size > 10_000)
    for (const [key, entry] of rateLimit) {
      if (entry.resetAt <= now) rateLimit.delete(key);
      if (rateLimit.size <= 10_000) break;
    }
  const key = rateLimitKey ?? requestFingerprint(publicReference);
  const current = rateLimit.get(key);
  if (!current && rateLimit.size >= 10_000) return false;
  if (!current || current.resetAt <= now) {
    rateLimit.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  current.count += 1;
  return current.count <= RATE_LIMIT_MAXIMUM;
}

export async function ensureEventGuestAccessRecord(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
  createdAt: Date,
) {
  await sql`select pg_advisory_xact_lock(hashtext(${`${eventOccurrenceId}:guest-access`}))`.execute(
    transaction,
  );
  const records = await transaction
    .selectFrom("event_guest_access")
    .select(["id", "publicReference", "generation", "createdAt", "revokedAt"])
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .orderBy("generation", "desc")
    .execute();
  const active = records.find((record) => record.revokedAt === null);
  if (active) return active;
  const created = {
    id: `event_guest_access_${randomUUID()}`,
    eventOccurrenceId,
    publicReference: issuePublicReference(),
    generation: (records[0]?.generation ?? 0) + 1,
    createdAt,
    revokedAt: null,
  };
  await transaction.insertInto("event_guest_access").values(created).execute();
  return created;
}

export async function rotateEventGuestAccessRecord(
  eventOccurrenceId: string,
  actor: AuthenticatedUser,
): Promise<string | null> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select(["id", "registrationMode"])
        .where("id", "=", eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      if (!occurrence || occurrence.registrationMode !== "open_entry")
        return null;
      const now = new Date();
      await transaction
        .updateTable("event_guest_access")
        .set({ revokedAt: now })
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .where("revokedAt", "is", null)
        .execute();
      const created = await ensureEventGuestAccessRecord(
        transaction,
        eventOccurrenceId,
        now,
      );
      await recordDurableAuditEvent(transaction, {
        actorUserId: actor.id,
        action: "event_occurrence.guest_access_rotated",
        subjectType: "event_guest_access",
        subjectId: created.id,
        aggregateId: eventOccurrenceId,
        metadata: { generation: created.generation },
        createdAt: now,
      });
      return created.publicReference;
    });
}

function accessState(
  occurrence: {
    status: "draft" | "published" | "cancelled" | "completed" | "archived";
    publishedAt: Date | null;
    endsAt: Date;
  },
  now: Date,
): "ready" | "not-open" | "closed" | "cancelled" {
  if (occurrence.status === "cancelled" || occurrence.status === "archived")
    return "cancelled";
  if (occurrence.status !== "published" || !occurrence.publishedAt)
    return "not-open";
  return now <= occurrence.endsAt ? "ready" : "closed";
}

async function findAccess(publicReference: string) {
  return await getDatabase()
    .selectFrom("event_guest_access as access")
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "access.eventOccurrenceId",
    )
    .select([
      "access.id as accessId",
      "occurrence.id",
      "occurrence.title",
      "occurrence.status",
      "occurrence.registrationMode",
      "occurrence.deliveryMode",
      "occurrence.startsAt",
      "occurrence.endsAt",
      "occurrence.timezone",
      "occurrence.publishedAt",
    ])
    .where("access.publicReference", "=", publicReference)
    .where("access.revokedAt", "is", null)
    .executeTakeFirst();
}

export async function findPublicEventGuestAccess(
  publicReference: string,
): Promise<EventGuestAccessResult> {
  const occurrence = await findAccess(publicReference);
  if (!occurrence || occurrence.registrationMode !== "open_entry")
    return { status: "not-found" };
  const state = accessState(occurrence, new Date());
  if (state !== "ready")
    return { status: "unavailable", reason: state, title: occurrence.title };
  return {
    status: "ready",
    data: {
      title: occurrence.title,
      deliveryMode: occurrence.deliveryMode,
      startsAt: occurrence.startsAt.toISOString(),
      endsAt: occurrence.endsAt.toISOString(),
      timezone: occurrence.timezone,
    },
  };
}

export async function submitPublicEventGuestAccess(
  input: {
    publicReference: string;
    name: string;
    email: string;
  },
  rateLimitKey?: string,
): Promise<EventGuestSubmissionResult> {
  if (!consumeRateLimit(input.publicReference, rateLimitKey)) {
    logServerEvent({
      level: "warn",
      event: "event_guest.rate_limited",
      fields: { entityType: "event_guest_access", outcome: "rate_limited" },
    });
    return { status: "rate-limited" };
  }
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const access = await transaction
        .selectFrom("event_guest_access as access")
        .innerJoin(
          "event_occurrence as occurrence",
          "occurrence.id",
          "access.eventOccurrenceId",
        )
        .select([
          "occurrence.id",
          "occurrence.title",
          "occurrence.status",
          "occurrence.registrationMode",
          "occurrence.deliveryMode",
          "occurrence.startsAt",
          "occurrence.endsAt",
          "occurrence.publishedAt",
          "occurrence.virtualJoinUrl",
          "occurrence.venueName",
          "occurrence.venueAddress",
          "occurrence.openEntryAttendanceMode",
        ])
        .where("access.publicReference", "=", input.publicReference)
        .where("access.revokedAt", "is", null)
        .forUpdate("occurrence")
        .executeTakeFirst();
      if (!access || access.registrationMode !== "open_entry")
        return { status: "not-found" } as const;
      const now = new Date();
      const state = accessState(access, now);
      if (state !== "ready")
        return { status: "unavailable", reason: state } as const;

      const provisioned = await provisionUser(transaction, {
        name: input.name,
        email: input.email,
        source: "open_entry",
        actorUserId: null,
        sourceEventId: access.id,
        createdAt: now,
      });
      const existing = await transaction
        .selectFrom("event_participation")
        .select(["id", "detailsSubmittedAt", "joinDisclosedAt", "checkedInAt"])
        .where("eventOccurrenceId", "=", access.id)
        .where("userId", "=", provisioned.user.id)
        .executeTakeFirst();
      const eventParticipationId =
        existing?.id ?? `event_participation_${randomUUID()}`;
      if (!existing)
        await transaction
          .insertInto("event_participation")
          .values({
            id: eventParticipationId,
            eventOccurrenceId: access.id,
            userId: provisioned.user.id,
            registrationId: null,
            mode: "open_entry",
            nameSnapshot: input.name.trim(),
            emailSnapshot: provisioned.user.email,
            detailsSubmittedAt: now,
            joinDisclosedAt: now,
            checkedInAt: null,
            privacyAcceptedAt: now,
            privacyNoticeVersion: EVENT_GUEST_PRIVACY_NOTICE_VERSION,
            completedAt: null,
            createdAt: now,
          })
          .execute();
      else
        await transaction
          .updateTable("event_participation")
          .set({
            detailsSubmittedAt: existing.detailsSubmittedAt ?? now,
            joinDisclosedAt: now,
            privacyAcceptedAt: now,
            privacyNoticeVersion: EVENT_GUEST_PRIVACY_NOTICE_VERSION,
          })
          .where("id", "=", existing.id)
          .execute();

      const activeSessions = await transaction
        .selectFrom("event_session")
        .select("id")
        .where("eventOccurrenceId", "=", access.id)
        .where("startsAt", "<=", now)
        .where("endsAt", ">=", now)
        .execute();
      const attendanceState = activeSessions.length
        ? access.openEntryAttendanceMode
        : "not_recorded";
      for (const session of activeSessions)
        await transaction
          .insertInto("event_attendance")
          .values({
            eventParticipationId,
            eventSessionId: session.id,
            state: access.openEntryAttendanceMode,
            source: "self_check_in",
            recordedByUserId: null,
            recordedAt: now,
            updatedAt: now,
          })
          .onConflict((conflict) =>
            conflict
              .columns(["eventParticipationId", "eventSessionId"])
              .doNothing(),
          )
          .execute();
      if (activeSessions.length && !existing?.checkedInAt)
        await transaction
          .updateTable("event_participation")
          .set({ checkedInAt: now })
          .where("id", "=", eventParticipationId)
          .execute();
      if (activeSessions.length)
        await completeEventParticipationIfReady(
          transaction,
          eventParticipationId,
          now,
        );

      logServerEvent({
        level: "info",
        event: "event_guest.accessed",
        fields: {
          entityType: "event_participation",
          entityId: eventParticipationId,
          aggregateId: access.id,
          outcome: attendanceState,
        },
      });
      return {
        status: "ready",
        data: {
          eventOccurrenceId: access.id,
          eventTitle: access.title,
          deliveryMode: access.deliveryMode,
          destinationUrl:
            access.deliveryMode === "virtual" ? access.virtualJoinUrl : null,
          venueName: access.venueName,
          venueAddress: access.venueAddress,
          attendanceState,
          accountSetupRequested: provisioned.created,
        },
      } as const;
    });
}
