import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";
import {
  enqueueRegistrationSelectedEventCommunications,
  enqueueRegistrationSubmittedEventCommunications,
} from "#/server/notifications/event-communication-execution.server";

export async function issueConfirmedEventRegistration(
  transaction: Transaction<Database>,
  input: {
    eventOccurrenceId: string;
    user: AuthenticatedUser;
    source: "paid_checkout" | "access_code";
    eligibilitySource: "paid" | "access_code";
    createdAt: Date;
  },
): Promise<
  | {
      status: "created";
      eventRegistrationId: string;
      eventParticipationId: string;
    }
  | { status: "already-registered"; eventRegistrationId: string }
  | { status: "unavailable" }
> {
  const occurrence = await transaction
    .selectFrom("event_occurrence")
    .select(["status", "startsAt", "capacity", "confirmedCount"])
    .where("id", "=", input.eventOccurrenceId)
    .forUpdate()
    .executeTakeFirst();
  if (
    !occurrence ||
    occurrence.status !== "published" ||
    occurrence.startsAt <= input.createdAt
  )
    return { status: "unavailable" };

  const existing = await transaction
    .selectFrom("event_registration")
    .select("id")
    .where("eventOccurrenceId", "=", input.eventOccurrenceId)
    .where("userId", "=", input.user.id)
    .executeTakeFirst();
  if (existing)
    return { status: "already-registered", eventRegistrationId: existing.id };
  if (occurrence.confirmedCount >= occurrence.capacity)
    return { status: "unavailable" };

  const eventRegistrationId = `event_registration_${randomUUID()}`;
  const eventParticipationId = `event_participation_${randomUUID()}`;
  await transaction
    .insertInto("event_registration")
    .values({
      id: eventRegistrationId,
      eventOccurrenceId: input.eventOccurrenceId,
      userId: input.user.id,
      eventOccurrenceRegionId: null,
      reviewRoundId: null,
      nameSnapshot: input.user.name,
      emailSnapshot: input.user.email,
      source: input.source,
      eligibilitySource: input.eligibilitySource,
      status: "selected",
      coordinatorPriority: null,
      submittedAt: input.createdAt,
      coordinatorDecidedAt: null,
      coordinatorDecidedByUserId: null,
      finalDecidedAt: input.createdAt,
      finalDecidedByUserId: null,
      lockedInAt: input.createdAt,
    })
    .execute();
  const transitionId = `event_registration_transition_${randomUUID()}`;
  await transaction
    .insertInto("event_registration_transition")
    .values({
      id: transitionId,
      eventRegistrationId,
      fromStatus: null,
      toStatus: "selected",
      source: "automatic",
      actorUserId: input.user.id,
      priority: null,
      occurredAt: input.createdAt,
    })
    .execute();
  await transaction
    .insertInto("event_participation")
    .values({
      id: eventParticipationId,
      eventOccurrenceId: input.eventOccurrenceId,
      userId: input.user.id,
      registrationId: eventRegistrationId,
      mode: "registered",
      nameSnapshot: input.user.name,
      emailSnapshot: input.user.email,
      detailsSubmittedAt: null,
      joinDisclosedAt: null,
      checkedInAt: null,
      createdAt: input.createdAt,
    })
    .execute();
  await enqueueRegistrationSubmittedEventCommunications(transaction, {
    eventOccurrenceId: input.eventOccurrenceId,
    eventRegistrationId,
    triggerEventId: transitionId,
    createdAt: input.createdAt,
  });
  await transaction
    .updateTable("event_occurrence")
    .set({
      confirmedCount: sql<number>`"confirmedCount" + 1`,
      updatedAt: input.createdAt,
    })
    .where("id", "=", input.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  await enqueueRegistrationSelectedEventCommunications(transaction, {
    eventOccurrenceId: input.eventOccurrenceId,
    eventRegistrationId,
    triggerEventId: transitionId,
    createdAt: input.createdAt,
  });
  await recordDurableAuditEvent(transaction, {
    actorUserId: input.user.id,
    action: "event_registration.submitted",
    subjectType: "event_registration",
    subjectId: eventRegistrationId,
    aggregateId: input.eventOccurrenceId,
    metadata: {
      registrationStatus: "selected",
      eligibilitySource: input.eligibilitySource,
      source: input.source,
    },
    createdAt: input.createdAt,
  });
  return {
    status: "created",
    eventRegistrationId,
    eventParticipationId,
  };
}
