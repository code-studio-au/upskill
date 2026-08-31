import "@tanstack/react-start/server-only";

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";
import {
  normalizeUserEmail,
  provisionUser,
} from "#/server/identity/provisional-user.server";
import { enqueueRegistrationSubmittedEventCommunications } from "#/server/notifications/event-communication-execution.server";
import { enqueueSystemEventNotification } from "#/server/notifications/notification.server";
import { buildEventNotificationVariables } from "#/server/notifications/offering-event-context.server";

function invitationToken(): string {
  return randomBytes(32).toString("base64url");
}

function tokenDigest(token: string): string {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update(token)
    .digest("base64url");
}

function invitationPath(token: string): string {
  return `/event-invitation#token=${token}`;
}

function invitationUrl(token: string): string {
  const url = new URL("/event-invitation", getServerEnv().APP_ORIGIN);
  url.hash = `token=${token}`;
  return url.toString();
}

function emailDomain(email: string): string | null {
  const separator = email.lastIndexOf("@");
  return separator > 0 && separator < email.length - 1
    ? email.slice(separator + 1).toLocaleLowerCase("en-AU")
    : null;
}

async function supersedeInvitationNotifications(
  transaction: Transaction<Database>,
  invitationId: string,
  now: Date,
): Promise<void> {
  await transaction
    .updateTable("notification")
    .set({
      status: "superseded",
      supersededAt: now,
      lastErrorCode: null,
      updatedAt: now,
    })
    .where(
      sql<boolean>`payload ->> 'eventLateRegistrationInvitationId' = ${invitationId}`,
    )
    .where("status", "in", ["pending", "failed"])
    .execute();
}

export async function createEventLateRegistrationInvitation(
  input: {
    eventOccurrenceId: string;
    name: string;
    email: string;
    eventOccurrenceRegionId: string | null;
    overrideDomainRestriction: boolean;
    expiresInDays: number;
  },
  actor: AuthenticatedUser,
): Promise<
  "created" | "duplicate" | "not-found" | "override-required" | "unavailable"
> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select([
          "id",
          "status",
          "startsAt",
          "timezone",
          "registrationClosesAt",
          "registrationMode",
        ])
        .where("id", "=", input.eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      const now = new Date();
      if (!occurrence) return "not-found" as const;
      if (
        occurrence.status !== "published" ||
        occurrence.startsAt <= now ||
        !occurrence.registrationClosesAt ||
        occurrence.registrationClosesAt > now ||
        occurrence.registrationMode === "open_entry" ||
        occurrence.registrationMode === "paid_entry"
      )
        return "unavailable" as const;

      const email = normalizeUserEmail(input.email);
      const existingUser = await transaction
        .selectFrom("user")
        .select(["id", "name", "email", "emailVerified", "accountState"])
        .where(sql<boolean>`lower(email) = ${email}`)
        .executeTakeFirst();
      if (existingUser) {
        const duplicate = await transaction
          .selectFrom("event_registration")
          .select("id")
          .where("eventOccurrenceId", "=", occurrence.id)
          .where("userId", "=", existingUser.id)
          .executeTakeFirst();
        if (duplicate) return "duplicate" as const;
      }

      if (occurrence.registrationMode === "required_restricted") {
        // The invitation can only be accepted after this exact address has
        // been verified, so its normalized domain is safe to evaluate here.
        const domain = emailDomain(email);
        const allowed = domain
          ? await transaction
              .selectFrom("event_occurrence_domain")
              .select("domain")
              .where("eventOccurrenceId", "=", occurrence.id)
              .where("domain", "=", domain)
              .executeTakeFirst()
          : null;
        if (!allowed && !input.overrideDomainRestriction)
          return "override-required" as const;
      }

      const occurrenceRegions = await transaction
        .selectFrom("event_occurrence_region")
        .select("id")
        .where("eventOccurrenceId", "=", occurrence.id)
        .where("retiredAt", "is", null)
        .execute();
      if (
        (occurrenceRegions.length > 0 && !input.eventOccurrenceRegionId) ||
        (input.eventOccurrenceRegionId &&
          !occurrenceRegions.some(
            (region) => region.id === input.eventOccurrenceRegionId,
          ))
      )
        return "not-found" as const;

      const invitationId = `event_late_registration_invitation_${randomUUID()}`;
      const token = invitationToken();
      const expiresAt = new Date(
        now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1_000,
      );
      const provisioned = await provisionUser(transaction, {
        name: existingUser?.name ?? input.name,
        email,
        source: "late_invitation",
        actorUserId: actor.id,
        sourceEventId: invitationId,
        createdAt: now,
        continuePath: invitationPath(token),
        refreshExistingSetup: {
          reason: "late_invitation",
          preserveExistingRequests: true,
        },
        setupPurpose: "late_registration_invitation",
        eventLateRegistrationInvitationId: invitationId,
      });

      const replaced = await transaction
        .updateTable("event_late_registration_invitation")
        .set({ revokedAt: now, revokedByUserId: actor.id })
        .where("eventOccurrenceId", "=", occurrence.id)
        .where("userId", "=", provisioned.user.id)
        .where("acceptedAt", "is", null)
        .where("revokedAt", "is", null)
        .returning("id")
        .execute();
      for (const invitation of replaced) {
        await supersedeInvitationNotifications(transaction, invitation.id, now);
        await recordDurableAuditEvent(transaction, {
          actorUserId: actor.id,
          action: "event_late_registration_invitation.revoked",
          subjectType: "event_late_registration_invitation",
          subjectId: invitation.id,
          aggregateId: occurrence.id,
          metadata: { reason: "replaced" },
          createdAt: now,
        });
      }

      await transaction
        .insertInto("event_late_registration_invitation")
        .values({
          id: invitationId,
          eventOccurrenceId: occurrence.id,
          userId: provisioned.user.id,
          eventOccurrenceRegionId: input.eventOccurrenceRegionId,
          recipientNameSnapshot: provisioned.user.name,
          recipientEmailSnapshot: provisioned.user.email,
          tokenDigest: tokenDigest(token),
          overrideDomainRestriction: input.overrideDomainRestriction,
          expiresAt,
          createdByUserId: actor.id,
          createdAt: now,
          acceptedAt: null,
          acceptedRegistrationId: null,
          revokedAt: null,
          revokedByUserId: null,
        })
        .execute();

      if (
        provisioned.user.accountState === "active" &&
        provisioned.user.emailVerified
      ) {
        const recipient = {
          userId: provisioned.user.id,
          name: provisioned.user.name,
          email: provisioned.user.email,
          registrationId: null,
          participationId: null,
        };
        const variables = await buildEventNotificationVariables(transaction, {
          eventOccurrenceId: occurrence.id,
          communication: {
            id: `system:${invitationId}`,
            sectionId: null,
            sessionDefinitionId: null,
          },
          recipient,
        });
        variables["event.invitationUrl"] = invitationUrl(token);
        variables["event.invitationExpiresAt"] = new Intl.DateTimeFormat(
          "en-AU",
          {
            dateStyle: "long",
            timeStyle: "short",
            timeZone: occurrence.timezone,
          },
        ).format(expiresAt);
        await enqueueSystemEventNotification(transaction, {
          systemKey: "event_late_registration_invitation",
          recipient,
          deduplicationKey: `event-late-invitation:${invitationId}:${recipient.userId}`,
          eventOccurrenceId: occurrence.id,
          trigger: "late_registration_invitation",
          audience: "affected_learner",
          eventLateRegistrationInvitationId: invitationId,
          anchorAt: now,
          variables,
          createdAt: now,
        });
      }

      await recordDurableAuditEvent(transaction, {
        actorUserId: actor.id,
        action: "event_late_registration_invitation.created",
        subjectType: "event_late_registration_invitation",
        subjectId: invitationId,
        aggregateId: occurrence.id,
        metadata: {
          userId: provisioned.user.id,
          eventOccurrenceRegionId: input.eventOccurrenceRegionId,
          expiresAt: expiresAt.toISOString(),
          overrideDomainRestriction: input.overrideDomainRestriction,
          accountState: provisioned.user.accountState,
        },
        createdAt: now,
      });
      return "created" as const;
    });
}

export async function revokeEventLateRegistrationInvitation(
  eventOccurrenceId: string,
  invitationId: string,
  actor: AuthenticatedUser,
): Promise<"revoked" | "not-found" | "unavailable"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const now = new Date();
      const revoked = await transaction
        .updateTable("event_late_registration_invitation")
        .set({ revokedAt: now, revokedByUserId: actor.id })
        .where("id", "=", invitationId)
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .where("acceptedAt", "is", null)
        .where("revokedAt", "is", null)
        .returning("id")
        .executeTakeFirst();
      if (!revoked) {
        const existing = await transaction
          .selectFrom("event_late_registration_invitation")
          .select("id")
          .where("id", "=", invitationId)
          .where("eventOccurrenceId", "=", eventOccurrenceId)
          .executeTakeFirst();
        return existing ? "unavailable" : "not-found";
      }
      await supersedeInvitationNotifications(transaction, invitationId, now);
      await recordDurableAuditEvent(transaction, {
        actorUserId: actor.id,
        action: "event_late_registration_invitation.revoked",
        subjectType: "event_late_registration_invitation",
        subjectId: invitationId,
        aggregateId: eventOccurrenceId,
        metadata: { reason: "administrator" },
        createdAt: now,
      });
      return "revoked";
    });
}

export async function revokeOutstandingEventLateInvitations(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
  actor: AuthenticatedUser,
  now: Date,
): Promise<number> {
  const revoked = await transaction
    .updateTable("event_late_registration_invitation")
    .set({ revokedAt: now, revokedByUserId: actor.id })
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("acceptedAt", "is", null)
    .where("revokedAt", "is", null)
    .returning("id")
    .execute();
  for (const invitation of revoked) {
    await supersedeInvitationNotifications(transaction, invitation.id, now);
    await recordDurableAuditEvent(transaction, {
      actorUserId: actor.id,
      action: "event_late_registration_invitation.revoked",
      subjectType: "event_late_registration_invitation",
      subjectId: invitation.id,
      aggregateId: eventOccurrenceId,
      metadata: { reason: "event_cancelled" },
      createdAt: now,
    });
  }
  return revoked.length;
}

export async function findEventLateRegistrationInvitation(
  token: string,
  user: AuthenticatedUser,
): Promise<
  | {
      status: "ready";
      invitationId: string;
      eventOccurrenceId: string;
      eventTitle: string;
      eventStartsAt: string;
      timezone: string;
      expiresAt: string;
    }
  | { status: "accepted"; eventOccurrenceId: string }
  | {
      status: "expired" | "forbidden" | "invalid" | "revoked" | "unavailable";
    }
> {
  const invitation = await getDatabase()
    .selectFrom("event_late_registration_invitation as invitation")
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "invitation.eventOccurrenceId",
    )
    .select([
      "invitation.id",
      "invitation.userId",
      "invitation.recipientEmailSnapshot",
      "invitation.expiresAt",
      "invitation.acceptedAt",
      "invitation.revokedAt",
      "occurrence.id as eventOccurrenceId",
      "occurrence.title as eventTitle",
      "occurrence.startsAt as eventStartsAt",
      "occurrence.timezone",
      "occurrence.status as eventStatus",
    ])
    .where("invitation.tokenDigest", "=", tokenDigest(token))
    .executeTakeFirst();
  if (!invitation) return { status: "invalid" };
  if (
    invitation.userId !== user.id ||
    !user.emailVerified ||
    normalizeUserEmail(user.email) !==
      normalizeUserEmail(invitation.recipientEmailSnapshot)
  )
    return { status: "forbidden" };
  if (invitation.revokedAt) return { status: "revoked" };
  if (invitation.acceptedAt)
    return {
      status: "accepted",
      eventOccurrenceId: invitation.eventOccurrenceId,
    };
  if (invitation.expiresAt <= new Date()) return { status: "expired" };
  if (
    invitation.eventStatus !== "published" ||
    invitation.eventStartsAt <= new Date()
  )
    return { status: "unavailable" };
  return {
    status: "ready",
    invitationId: invitation.id,
    eventOccurrenceId: invitation.eventOccurrenceId,
    eventTitle: invitation.eventTitle,
    eventStartsAt: invitation.eventStartsAt.toISOString(),
    timezone: invitation.timezone,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

export async function acceptEventLateRegistrationInvitation(
  token: string,
  user: AuthenticatedUser,
): Promise<
  | { status: "registered" | "already-registered"; eventOccurrenceId: string }
  | {
      status:
        | "expired"
        | "forbidden"
        | "ineligible"
        | "invalid"
        | "revoked"
        | "unavailable";
    }
> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const invitation = await transaction
        .selectFrom("event_late_registration_invitation as invitation")
        .innerJoin(
          "event_occurrence as occurrence",
          "occurrence.id",
          "invitation.eventOccurrenceId",
        )
        .select([
          "invitation.id",
          "invitation.eventOccurrenceId",
          "invitation.userId",
          "invitation.eventOccurrenceRegionId",
          "invitation.recipientNameSnapshot",
          "invitation.recipientEmailSnapshot",
          "invitation.overrideDomainRestriction",
          "invitation.expiresAt",
          "invitation.acceptedAt",
          "invitation.revokedAt",
          "invitation.createdByUserId",
          "occurrence.status as eventStatus",
          "occurrence.startsAt",
          "occurrence.registrationMode",
        ])
        .where("invitation.tokenDigest", "=", tokenDigest(token))
        .forUpdate(["invitation", "occurrence"])
        .executeTakeFirst();
      if (!invitation) return { status: "invalid" } as const;
      if (
        invitation.userId !== user.id ||
        !user.emailVerified ||
        normalizeUserEmail(user.email) !==
          normalizeUserEmail(invitation.recipientEmailSnapshot)
      )
        return { status: "forbidden" } as const;
      if (invitation.revokedAt) return { status: "revoked" } as const;
      if (invitation.expiresAt <= new Date())
        return { status: "expired" } as const;
      if (
        invitation.acceptedAt ||
        invitation.eventStatus !== "published" ||
        invitation.startsAt <= new Date()
      )
        return { status: "unavailable" } as const;

      const existing = await transaction
        .selectFrom("event_registration")
        .select("id")
        .where("eventOccurrenceId", "=", invitation.eventOccurrenceId)
        .where("userId", "=", user.id)
        .executeTakeFirst();
      if (existing) {
        const now = new Date();
        await transaction
          .updateTable("event_late_registration_invitation")
          .set({ acceptedAt: now, acceptedRegistrationId: existing.id })
          .where("id", "=", invitation.id)
          .executeTakeFirstOrThrow();
        await supersedeInvitationNotifications(transaction, invitation.id, now);
        await recordDurableAuditEvent(transaction, {
          actorUserId: user.id,
          action: "event_late_registration_invitation.accepted",
          subjectType: "event_late_registration_invitation",
          subjectId: invitation.id,
          aggregateId: invitation.eventOccurrenceId,
          metadata: {
            registrationId: existing.id,
            reconciledExistingRegistration: true,
          },
          createdAt: now,
        });
        return {
          status: "already-registered",
          eventOccurrenceId: invitation.eventOccurrenceId,
        } as const;
      }

      let eligibilitySource:
        "administrator_override" | "unrestricted" | "verified_domain" =
        "unrestricted";
      if (invitation.registrationMode === "required_restricted") {
        const domain = emailDomain(user.email);
        const allowed = domain
          ? await transaction
              .selectFrom("event_occurrence_domain")
              .select("domain")
              .where("eventOccurrenceId", "=", invitation.eventOccurrenceId)
              .where("domain", "=", domain)
              .executeTakeFirst()
          : null;
        if (!allowed && !invitation.overrideDomainRestriction)
          return { status: "ineligible" } as const;
        eligibilitySource = allowed
          ? "verified_domain"
          : "administrator_override";
      }
      if (invitation.eventOccurrenceRegionId) {
        const region = await transaction
          .selectFrom("event_occurrence_region")
          .select("id")
          .where("id", "=", invitation.eventOccurrenceRegionId)
          .where("eventOccurrenceId", "=", invitation.eventOccurrenceId)
          .where("retiredAt", "is", null)
          .executeTakeFirst();
        if (!region) return { status: "unavailable" } as const;
      }

      const now = new Date();
      const registrationId = `event_registration_${randomUUID()}`;
      const transitionId = `event_registration_transition_${randomUUID()}`;
      await transaction
        .insertInto("event_registration")
        .values({
          id: registrationId,
          eventOccurrenceId: invitation.eventOccurrenceId,
          userId: user.id,
          eventOccurrenceRegionId: invitation.eventOccurrenceRegionId,
          reviewRoundId: null,
          nameSnapshot: invitation.recipientNameSnapshot,
          emailSnapshot: invitation.recipientEmailSnapshot,
          source: "late_invitation",
          eligibilitySource,
          status: "submitted",
          coordinatorPriority: null,
          submittedAt: now,
          coordinatorDecidedAt: null,
          coordinatorDecidedByUserId: null,
          finalDecidedAt: null,
          finalDecidedByUserId: null,
          lockedInAt: null,
          regionalReviewWaivedAt: now,
          regionalReviewWaivedByUserId: invitation.createdByUserId,
        })
        .execute();
      await transaction
        .insertInto("event_registration_transition")
        .values({
          id: transitionId,
          eventRegistrationId: registrationId,
          fromStatus: null,
          toStatus: "submitted",
          source: "learner",
          actorUserId: user.id,
          priority: null,
          occurredAt: now,
        })
        .execute();
      await transaction
        .updateTable("event_late_registration_invitation")
        .set({ acceptedAt: now, acceptedRegistrationId: registrationId })
        .where("id", "=", invitation.id)
        .executeTakeFirstOrThrow();
      await enqueueRegistrationSubmittedEventCommunications(transaction, {
        eventOccurrenceId: invitation.eventOccurrenceId,
        eventRegistrationId: registrationId,
        triggerEventId: transitionId,
        createdAt: now,
      });
      await supersedeInvitationNotifications(transaction, invitation.id, now);
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: "event_late_registration_invitation.accepted",
        subjectType: "event_late_registration_invitation",
        subjectId: invitation.id,
        aggregateId: invitation.eventOccurrenceId,
        metadata: { registrationId },
        createdAt: now,
      });
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: "event_registration.submitted",
        subjectType: "event_registration",
        subjectId: registrationId,
        aggregateId: invitation.eventOccurrenceId,
        metadata: { registrationStatus: "submitted", eligibilitySource },
        createdAt: now,
      });
      return {
        status: "registered",
        eventOccurrenceId: invitation.eventOccurrenceId,
      } as const;
    });
}
