import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { normalizeEventCommunicationAudience } from "#/features/admin-email/communication-options";
import {
  buildEventNotificationVariables,
  type EventCommunicationContentSnapshot,
  type EventNotificationRecipient,
} from "./offering-event-context.server";
import {
  hasIncompleteAvailableEventPostwork,
  hasIncompleteAvailableEventPrework,
} from "./event-prework.server";
import { enqueueOfferingEventNotification } from "./notification.server";
import { processNextEventOperationalCommunicationSchedule } from "./event-operational-communication.server";

const SCHEDULE_LEASE_MILLISECONDS = 15 * 60_000;
const MAX_SCHEDULE_ATTEMPTS = 5;
const DEFAULT_SCHEDULE_BATCH_SIZE = 25;

type EventCommunicationAudience =
  | "active_registrants"
  | "affected_learner"
  | "confirmed_participants"
  | "presenters"
  | "coordinators"
  | "administrators";

type EventCommunicationTrigger =
  | "event_cancelled"
  | "event_completed"
  | "event_end"
  | "event_rescheduled"
  | "event_start"
  | "post_event_incomplete"
  | "prework_incomplete"
  | "registration_cancelled"
  | "registration_not_selected"
  | "registration_selected"
  | "registration_submitted"
  | "registration_waitlisted"
  | "section_release"
  | "session_start";

export type EventCommunicationScheduleOutcome =
  | { status: "no-work" }
  | {
      status: "completed";
      scheduleId: string;
      recipientCount: number;
    }
  | { status: "retry"; scheduleId: string }
  | { status: "failed"; scheduleId: string };

type ProcessedScheduleOutcome = Exclude<
  EventCommunicationScheduleOutcome,
  { status: "no-work" }
>;

export interface EventCommunicationScheduleBatch {
  outcomes: Array<ProcessedScheduleOutcome>;
  limitReached: boolean;
}

function offsetMilliseconds(
  amount: number,
  unit: "minute" | "hour" | "day" | "week",
): number {
  const minutes =
    unit === "minute"
      ? amount
      : unit === "hour"
        ? amount * 60
        : unit === "day"
          ? amount * 24 * 60
          : amount * 7 * 24 * 60;
  return minutes * 60_000;
}

function safeScheduleErrorCode(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === "EMAIL_TEMPLATE_CONTEXT_INVALID")
      return error.message;
    if (error.message === "EMAIL_TEMPLATE_INVALID") return error.message;
    if (error.message === "EMAIL_TEMPLATE_CONTRACT_NOT_FOUND")
      return error.message;
  }
  return "EVENT_COMMUNICATION_SCHEDULE_FAILED";
}

export async function refreshEventCommunicationSchedules(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
  now: Date,
): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(${`event-communication-schedules:${eventOccurrenceId}`}))`.execute(
    transaction,
  );
  const occurrence = await transaction
    .selectFrom("event_occurrence")
    .select(["status", "startsAt", "endsAt"])
    .where("id", "=", eventOccurrenceId)
    .executeTakeFirstOrThrow();
  const communications = await transaction
    .selectFrom("event_occurrence_communication_revision")
    .select([
      "id",
      "logicalId",
      "trigger",
      "sessionDefinitionId",
      "offsetAmount",
      "offsetUnit",
    ])
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("active", "=", true)
    .where("trigger", "in", [
      "event_start",
      "event_end",
      "session_start",
      "post_event_incomplete",
      "prework_incomplete",
    ])
    .execute();

  for (const communication of communications) {
    const schedules = await transaction
      .selectFrom("event_communication_schedule")
      .selectAll()
      .where("logicalId", "=", communication.logicalId)
      .orderBy("revision", "desc")
      .forUpdate()
      .execute();
    const active = schedules.find((schedule) =>
      (["pending", "processing"] as const).includes(schedule.status as never),
    );
    const delivered = schedules.some(
      (schedule) => schedule.status === "completed",
    );
    if (occurrence.status !== "published" || delivered) {
      if (active)
        await transaction
          .updateTable("event_communication_schedule")
          .set({
            status: "superseded",
            supersededAt: now,
            updatedAt: now,
          })
          .where("id", "=", active.id)
          .executeTakeFirstOrThrow();
      continue;
    }
    const session =
      communication.trigger === "session_start" &&
      communication.sessionDefinitionId
        ? await transaction
            .selectFrom("event_session")
            .select("startsAt")
            .where("eventOccurrenceId", "=", eventOccurrenceId)
            .where(
              "sessionDefinitionId",
              "=",
              communication.sessionDefinitionId,
            )
            .executeTakeFirst()
        : undefined;
    const anchor =
      communication.trigger === "event_end" ||
      communication.trigger === "post_event_incomplete"
        ? occurrence.endsAt
        : communication.trigger === "session_start"
          ? session?.startsAt
          : occurrence.startsAt;
    if (!anchor) {
      if (active)
        await transaction
          .updateTable("event_communication_schedule")
          .set({ status: "superseded", supersededAt: now, updatedAt: now })
          .where("id", "=", active.id)
          .executeTakeFirstOrThrow();
      continue;
    }
    const dueAt = new Date(
      anchor.getTime() +
        offsetMilliseconds(
          communication.offsetAmount,
          communication.offsetUnit,
        ),
    );
    if (
      active?.eventOccurrenceCommunicationRevisionId === communication.id &&
      active.dueAt.getTime() === dueAt.getTime()
    )
      continue;
    if (active)
      await transaction
        .updateTable("event_communication_schedule")
        .set({
          status: "superseded",
          supersededAt: now,
          updatedAt: now,
        })
        .where("id", "=", active.id)
        .executeTakeFirstOrThrow();
    await transaction
      .insertInto("event_communication_schedule")
      .values({
        id: `event_communication_schedule_${randomUUID()}`,
        logicalId: communication.logicalId,
        revision: (schedules[0]?.revision ?? 0) + 1,
        eventOccurrenceId,
        eventOccurrenceCommunicationRevisionId: communication.id,
        trigger: communication.trigger as
          | "event_end"
          | "event_start"
          | "post_event_incomplete"
          | "prework_incomplete"
          | "session_start",
        dueAt,
        status: "pending",
        attempts: 0,
        availableAt: dueAt,
        lastErrorCode: null,
        recipientCount: null,
        processedAt: null,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  }
}

export async function supersedeEventCommunicationSchedules(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
  now: Date,
): Promise<void> {
  await transaction
    .updateTable("event_communication_schedule")
    .set({ status: "superseded", supersededAt: now, updatedAt: now })
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("status", "in", ["pending", "processing"])
    .execute();
}

async function confirmedRecipients(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
): Promise<Array<EventNotificationRecipient>> {
  return await transaction
    .selectFrom("event_registration as registration")
    .innerJoin("user", "user.id", "registration.userId")
    .leftJoin(
      "event_participation as participation",
      "participation.registrationId",
      "registration.id",
    )
    .select([
      "user.id as userId",
      "user.name",
      "user.email",
      "registration.id as registrationId",
      "participation.id as participationId",
    ])
    .where("registration.eventOccurrenceId", "=", eventOccurrenceId)
    .where("registration.status", "=", "selected")
    .orderBy("registration.id")
    .execute();
}

async function activeRegistrantRecipients(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
): Promise<Array<EventNotificationRecipient>> {
  return await transaction
    .selectFrom("event_registration as registration")
    .innerJoin("user", "user.id", "registration.userId")
    .leftJoin(
      "event_participation as participation",
      "participation.registrationId",
      "registration.id",
    )
    .select([
      "user.id as userId",
      "user.name",
      "user.email",
      "registration.id as registrationId",
      "participation.id as participationId",
    ])
    .where("registration.eventOccurrenceId", "=", eventOccurrenceId)
    .where("registration.status", "not in", [
      "cancelled",
      "not_selected",
      "withdrawn",
    ])
    .orderBy("registration.id")
    .execute();
}

async function staffRecipients(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
  audience: Exclude<
    EventCommunicationAudience,
    "active_registrants" | "affected_learner" | "confirmed_participants"
  >,
): Promise<Array<EventNotificationRecipient>> {
  if (audience === "administrators") {
    const rows = await transaction
      .selectFrom("event_admin_assignment as assignment")
      .innerJoin("user", "user.id", "assignment.userId")
      .select(["user.id as userId", "user.name", "user.email"])
      .where("assignment.eventOccurrenceId", "=", eventOccurrenceId)
      .where("assignment.endedAt", "is", null)
      .execute();
    return rows.map((row) => ({
      ...row,
      registrationId: null,
      participationId: null,
    }));
  }
  if (audience === "presenters") {
    const rows = await transaction
      .selectFrom("event_presenter_assignment as assignment")
      .innerJoin("user", "user.id", "assignment.userId")
      .select(["user.id as userId", "user.name", "user.email"])
      .where("assignment.eventOccurrenceId", "=", eventOccurrenceId)
      .where("assignment.endedAt", "is", null)
      .execute();
    return rows.map((row) => ({
      ...row,
      registrationId: null,
      participationId: null,
    }));
  }
  const rows = await transaction
    .selectFrom("event_coordinator_assignment as assignment")
    .innerJoin(
      "event_occurrence_region as occurrenceRegion",
      "occurrenceRegion.id",
      "assignment.eventOccurrenceRegionId",
    )
    .innerJoin("user", "user.id", "assignment.userId")
    .select(["user.id as userId", "user.name", "user.email"])
    .where("occurrenceRegion.eventOccurrenceId", "=", eventOccurrenceId)
    .where("occurrenceRegion.retiredAt", "is", null)
    .where("assignment.endedAt", "is", null)
    .execute();
  return rows.map((row) => ({
    ...row,
    registrationId: null,
    participationId: null,
  }));
}

async function scheduledRecipients(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
  audience: EventCommunicationAudience,
): Promise<Array<EventNotificationRecipient>> {
  const recipients =
    audience === "active_registrants"
      ? await activeRegistrantRecipients(transaction, eventOccurrenceId)
      : audience === "affected_learner" || audience === "confirmed_participants"
        ? await confirmedRecipients(transaction, eventOccurrenceId)
        : await staffRecipients(transaction, eventOccurrenceId, audience);
  return [
    ...new Map(
      recipients.map((recipient) => [recipient.userId, recipient]),
    ).values(),
  ];
}

async function materializeSchedule(
  transaction: Transaction<Database>,
  schedule: {
    id: string;
    eventOccurrenceId: string;
    eventOccurrenceCommunicationRevisionId: string;
    trigger:
      | "event_end"
      | "event_start"
      | "post_event_incomplete"
      | "prework_incomplete"
      | "session_start";
  },
  createdAt: Date,
): Promise<number> {
  const communication = await transaction
    .selectFrom("event_occurrence_communication_revision as communication")
    .innerJoin(
      "email_design_version as version",
      "version.id",
      "communication.emailDesignVersionId",
    )
    .select([
      "communication.id",
      "communication.sectionId",
      "communication.sessionDefinitionId",
      "communication.audience",
      "communication.emailDesignVersionId",
      "communication.subject",
      "communication.textBody",
      "communication.offsetAmount",
      "communication.offsetUnit",
      "communication.active",
      "version.contractKey",
      "version.contractVersion",
      "version.publishedAt",
    ])
    .where(
      "communication.id",
      "=",
      schedule.eventOccurrenceCommunicationRevisionId,
    )
    .where("communication.eventOccurrenceId", "=", schedule.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  const occurrence = await transaction
    .selectFrom("event_occurrence")
    .select("status")
    .where("id", "=", schedule.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  const occurrenceEligible =
    occurrence.status === "published" ||
    (schedule.trigger === "post_event_incomplete" &&
      occurrence.status === "completed");
  if (
    !occurrenceEligible ||
    !communication.active ||
    communication.contractKey !== "offering.event" ||
    communication.contractVersion !== 1 ||
    !communication.publishedAt
  )
    return 0;
  let recipients = await scheduledRecipients(
    transaction,
    schedule.eventOccurrenceId,
    communication.audience,
  );
  if (schedule.trigger === "prework_incomplete")
    recipients = (
      await Promise.all(
        recipients.map(async (recipient) => ({
          recipient,
          applicable: Boolean(
            recipient.registrationId &&
            recipient.participationId &&
            (await hasIncompleteAvailableEventPrework(transaction, {
              eventOccurrenceId: schedule.eventOccurrenceId,
              eventRegistrationId: recipient.registrationId,
              eventParticipationId: recipient.participationId,
              userId: recipient.userId,
              now: createdAt,
            })),
          ),
        })),
      )
    )
      .filter((entry) => entry.applicable)
      .map((entry) => entry.recipient);
  if (schedule.trigger === "post_event_incomplete")
    recipients = (
      await Promise.all(
        recipients.map(async (recipient) => ({
          recipient,
          applicable: Boolean(
            recipient.registrationId &&
            recipient.participationId &&
            (await hasIncompleteAvailableEventPostwork(transaction, {
              eventOccurrenceId: schedule.eventOccurrenceId,
              eventRegistrationId: recipient.registrationId,
              eventParticipationId: recipient.participationId,
              userId: recipient.userId,
              now: createdAt,
            })),
          ),
        })),
      )
    )
      .filter((entry) => entry.applicable)
      .map((entry) => entry.recipient);
  const content: EventCommunicationContentSnapshot = communication;
  for (const recipient of recipients) {
    const variables = await buildEventNotificationVariables(transaction, {
      eventOccurrenceId: schedule.eventOccurrenceId,
      communication: content,
      recipient,
    });
    await enqueueOfferingEventNotification(transaction, {
      recipient,
      emailDesignVersionId: communication.emailDesignVersionId,
      subjectTemplateSnapshot: communication.subject,
      textBodyTemplateSnapshot: communication.textBody,
      deduplicationKey: `${schedule.id}:${recipient.userId}`,
      eventOccurrenceId: schedule.eventOccurrenceId,
      eventOccurrenceCommunicationRevisionId: communication.id,
      trigger: schedule.trigger,
      audience: communication.audience,
      eventRegistrationId: recipient.registrationId,
      eventParticipationId: recipient.participationId,
      variables,
      createdAt,
    });
  }
  return recipients.length;
}

export async function processNextEventCommunicationSchedule(
  now = new Date(),
): Promise<EventCommunicationScheduleOutcome> {
  const database = getDatabase();
  const claimed = await database.transaction().execute(async (transaction) => {
    const schedule = await transaction
      .selectFrom("event_communication_schedule")
      .select(["id", "attempts"])
      .where("status", "in", ["pending", "processing"])
      .where("dueAt", "<=", now)
      .where("availableAt", "<=", now)
      .orderBy("dueAt")
      .orderBy("id")
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!schedule) return undefined;
    const attempt = schedule.attempts + 1;
    await transaction
      .updateTable("event_communication_schedule")
      .set({
        status: "processing",
        attempts: attempt,
        availableAt: new Date(now.getTime() + SCHEDULE_LEASE_MILLISECONDS),
        updatedAt: now,
      })
      .where("id", "=", schedule.id)
      .executeTakeFirstOrThrow();
    return { id: schedule.id, attempt };
  });
  if (!claimed) return { status: "no-work" };

  try {
    const recipientCount = await database
      .transaction()
      .execute(async (transaction) => {
        const schedule = await transaction
          .selectFrom("event_communication_schedule")
          .select([
            "id",
            "eventOccurrenceId",
            "eventOccurrenceCommunicationRevisionId",
            "trigger",
            "status",
            "attempts",
          ])
          .where("id", "=", claimed.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (
          schedule.status !== "processing" ||
          schedule.attempts !== claimed.attempt
        )
          return null;
        const count = await materializeSchedule(transaction, schedule, now);
        await transaction
          .updateTable("event_communication_schedule")
          .set({
            status: "completed",
            recipientCount: count,
            processedAt: now,
            lastErrorCode: null,
            updatedAt: now,
          })
          .where("id", "=", schedule.id)
          .where("status", "=", "processing")
          .where("attempts", "=", claimed.attempt)
          .executeTakeFirstOrThrow();
        return count;
      });
    if (recipientCount === null) return { status: "no-work" };
    return {
      status: "completed",
      scheduleId: claimed.id,
      recipientCount,
    };
  } catch (error) {
    const failed = claimed.attempt >= MAX_SCHEDULE_ATTEMPTS;
    const delaySeconds = Math.min(30 * 2 ** (claimed.attempt - 1), 15 * 60);
    await database
      .updateTable("event_communication_schedule")
      .set({
        status: failed ? "failed" : "pending",
        availableAt: new Date(now.getTime() + delaySeconds * 1_000),
        lastErrorCode: safeScheduleErrorCode(error),
        updatedAt: now,
      })
      .where("id", "=", claimed.id)
      .where("status", "=", "processing")
      .where("attempts", "=", claimed.attempt)
      .execute();
    return {
      status: failed ? "failed" : "retry",
      scheduleId: claimed.id,
    };
  }
}

export async function processAvailableEventCommunicationSchedules(
  limit = DEFAULT_SCHEDULE_BATCH_SIZE,
): Promise<EventCommunicationScheduleBatch> {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError("Schedule batch limit must be a positive integer");
  const outcomes: Array<ProcessedScheduleOutcome> = [];
  for (let index = 0; index < limit; index += 1) {
    const operational =
      await processNextEventOperationalCommunicationSchedule();
    const outcome =
      operational.status === "no-work"
        ? await processNextEventCommunicationSchedule()
        : operational;
    if (outcome.status === "no-work") return { outcomes, limitReached: false };
    outcomes.push(outcome);
  }
  return { outcomes, limitReached: true };
}

async function enqueueEventTransitionCommunications(
  transaction: Transaction<Database>,
  input: {
    eventOccurrenceId: string;
    eventRegistrationId: string;
    triggerEventId: string;
    trigger:
      | "registration_cancelled"
      | "registration_not_selected"
      | "registration_selected"
      | "registration_submitted"
      | "registration_waitlisted";
    createdAt: Date;
  },
): Promise<number> {
  const recipient = await transaction
    .selectFrom("event_registration as registration")
    .innerJoin("user", "user.id", "registration.userId")
    .leftJoin(
      "event_participation as participation",
      "participation.registrationId",
      "registration.id",
    )
    .select([
      "user.id as userId",
      "user.name",
      "user.email",
      "registration.id as registrationId",
      "participation.id as participationId",
      "registration.status",
    ])
    .where("registration.id", "=", input.eventRegistrationId)
    .where("registration.eventOccurrenceId", "=", input.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  const expectedStatus = {
    registration_cancelled: "cancelled",
    registration_not_selected: "not_selected",
    registration_selected: "selected",
    registration_submitted: "submitted",
    registration_waitlisted: "waitlisted",
  }[input.trigger];
  const statusMatches =
    input.trigger === "registration_submitted"
      ? recipient.status === "submitted" || recipient.status === "selected"
      : recipient.status === expectedStatus;
  if (!statusMatches) return 0;
  return await enqueueEventTriggeredCommunications(transaction, {
    eventOccurrenceId: input.eventOccurrenceId,
    triggerEventId: input.triggerEventId,
    trigger: input.trigger,
    affectedRecipient: recipient,
    createdAt: input.createdAt,
  });
}

async function enqueueEventTriggeredCommunications(
  transaction: Transaction<Database>,
  input: {
    eventOccurrenceId: string;
    triggerEventId: string;
    trigger: EventCommunicationTrigger;
    affectedRecipient?: EventNotificationRecipient;
    eventTemplateVersionSectionId?: string;
    anchorAt?: Date;
    createdAt: Date;
  },
): Promise<number> {
  let communicationsQuery = transaction
    .selectFrom("event_occurrence_communication_revision as communication")
    .innerJoin(
      "email_design_version as version",
      "version.id",
      "communication.emailDesignVersionId",
    )
    .select([
      "communication.id",
      "communication.logicalId",
      "communication.sectionId",
      "communication.sessionDefinitionId",
      "communication.audience",
      "communication.emailDesignVersionId",
      "communication.subject",
      "communication.textBody",
      "communication.offsetAmount",
      "communication.offsetUnit",
      "version.contractKey",
      "version.contractVersion",
      "version.publishedAt",
    ])
    .where("communication.eventOccurrenceId", "=", input.eventOccurrenceId)
    .where("communication.active", "=", true)
    .where("communication.trigger", "=", input.trigger);
  if (input.trigger === "section_release")
    communicationsQuery = communicationsQuery.where(
      "communication.sectionId",
      "=",
      input.eventTemplateVersionSectionId ?? "",
    );
  const communications = await communicationsQuery.execute();
  let created = 0;
  for (const communication of communications) {
    if (
      communication.contractKey !== "offering.event" ||
      communication.contractVersion !== 1 ||
      !communication.publishedAt
    )
      continue;
    const audience = normalizeEventCommunicationAudience(
      input.trigger,
      communication.audience,
    );
    const recipients =
      audience === "affected_learner"
        ? input.affectedRecipient
          ? [input.affectedRecipient]
          : []
        : await scheduledRecipients(
            transaction,
            input.eventOccurrenceId,
            audience,
          );
    for (const recipient of recipients) {
      const variables = await buildEventNotificationVariables(transaction, {
        eventOccurrenceId: input.eventOccurrenceId,
        communication,
        recipient,
        ...(input.trigger === "event_rescheduled"
          ? { eventRescheduleId: input.triggerEventId }
          : {}),
      });
      await enqueueOfferingEventNotification(transaction, {
        recipient,
        emailDesignVersionId: communication.emailDesignVersionId,
        subjectTemplateSnapshot: communication.subject,
        textBodyTemplateSnapshot: communication.textBody,
        deduplicationKey: `${communication.logicalId}:${input.triggerEventId}:${recipient.userId}`,
        eventOccurrenceId: input.eventOccurrenceId,
        eventOccurrenceCommunicationRevisionId: communication.id,
        trigger: input.trigger,
        audience,
        eventRegistrationId: recipient.registrationId,
        eventParticipationId: recipient.participationId,
        eventTemplateVersionSectionId:
          input.eventTemplateVersionSectionId ?? null,
        eventRescheduleId:
          input.trigger === "event_rescheduled" ? input.triggerEventId : null,
        ...(input.anchorAt ? { anchorAt: input.anchorAt } : {}),
        variables,
        createdAt: input.createdAt,
        availableAt: new Date(
          Math.max(
            input.createdAt.getTime(),
            input.createdAt.getTime() +
              offsetMilliseconds(
                communication.offsetAmount,
                communication.offsetUnit,
              ),
          ),
        ),
      });
      created += 1;
    }
  }
  return created;
}

export async function enqueueRegistrationSelectedEventCommunications(
  transaction: Transaction<Database>,
  input: {
    eventOccurrenceId: string;
    eventRegistrationId: string;
    triggerEventId: string;
    createdAt: Date;
  },
): Promise<number> {
  return await enqueueEventTransitionCommunications(transaction, {
    ...input,
    trigger: "registration_selected",
  });
}

export async function enqueueRegistrationOutcomeEventCommunications(
  transaction: Transaction<Database>,
  input: {
    eventOccurrenceId: string;
    eventRegistrationId: string;
    triggerEventId: string;
    outcome: "cancelled" | "not_selected" | "waitlisted";
    createdAt: Date;
  },
): Promise<number> {
  const trigger = {
    cancelled: "registration_cancelled",
    not_selected: "registration_not_selected",
    waitlisted: "registration_waitlisted",
  } as const;
  return await enqueueEventTransitionCommunications(transaction, {
    eventOccurrenceId: input.eventOccurrenceId,
    eventRegistrationId: input.eventRegistrationId,
    triggerEventId: input.triggerEventId,
    trigger: trigger[input.outcome],
    createdAt: input.createdAt,
  });
}

export async function enqueueEventOccurrenceLifecycleCommunications(
  transaction: Transaction<Database>,
  input: {
    eventOccurrenceId: string;
    triggerEventId: string;
    trigger: "event_cancelled" | "event_rescheduled";
    anchorAt: Date;
    createdAt: Date;
  },
): Promise<number> {
  return await enqueueEventTriggeredCommunications(transaction, {
    eventOccurrenceId: input.eventOccurrenceId,
    triggerEventId: input.triggerEventId,
    trigger: input.trigger,
    anchorAt: input.anchorAt,
    createdAt: input.createdAt,
  });
}

export async function enqueueRegistrationSubmittedEventCommunications(
  transaction: Transaction<Database>,
  input: {
    eventOccurrenceId: string;
    eventRegistrationId: string;
    triggerEventId: string;
    createdAt: Date;
  },
): Promise<number> {
  return await enqueueEventTransitionCommunications(transaction, {
    ...input,
    trigger: "registration_submitted",
  });
}

export async function enqueueEventParticipationCommunications(
  transaction: Transaction<Database>,
  input: {
    eventParticipationId: string;
    triggerEventId: string;
    trigger: "event_completed" | "section_release";
    eventTemplateVersionSectionId?: string;
    createdAt: Date;
  },
): Promise<number> {
  const recipient = await transaction
    .selectFrom("event_participation as participation")
    .innerJoin("user", "user.id", "participation.userId")
    .select([
      "participation.eventOccurrenceId",
      "participation.registrationId",
      "participation.id as participationId",
      "participation.completedAt",
      "user.id as userId",
      "user.name",
      "user.email",
    ])
    .where("participation.id", "=", input.eventParticipationId)
    .executeTakeFirstOrThrow();
  if (input.trigger === "event_completed" && !recipient.completedAt) return 0;
  return await enqueueEventTriggeredCommunications(transaction, {
    eventOccurrenceId: recipient.eventOccurrenceId,
    triggerEventId: input.triggerEventId,
    trigger: input.trigger,
    affectedRecipient: recipient,
    ...(input.eventTemplateVersionSectionId
      ? {
          eventTemplateVersionSectionId: input.eventTemplateVersionSectionId,
        }
      : {}),
    ...(input.trigger === "event_completed" && recipient.completedAt
      ? { anchorAt: recipient.completedAt }
      : {}),
    createdAt: input.createdAt,
  });
}
