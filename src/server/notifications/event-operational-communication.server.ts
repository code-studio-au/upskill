import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { enqueueSystemEventNotification } from "./notification.server";
import {
  buildEventNotificationVariables,
  type EventNotificationRecipient,
} from "./offering-event-context.server";

const SCHEDULE_LEASE_MILLISECONDS = 15 * 60_000;
const MAX_SCHEDULE_ATTEMPTS = 5;

export type EventOperationalScheduleOutcome =
  | { status: "no-work" }
  | { status: "completed"; scheduleId: string; recipientCount: number }
  | { status: "retry"; scheduleId: string }
  | { status: "failed"; scheduleId: string };

async function ensureInitialReviewRounds(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
): Promise<void> {
  const occurrence = await transaction
    .selectFrom("event_occurrence")
    .select(["approvalMode", "registrationClosesAt", "coordinatorLockAt"])
    .where("id", "=", eventOccurrenceId)
    .executeTakeFirstOrThrow();
  if (
    occurrence.approvalMode !== "manual" ||
    !occurrence.registrationClosesAt ||
    !occurrence.coordinatorLockAt
  )
    return;
  const regions = await transaction
    .selectFrom("event_occurrence_region")
    .select("id")
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("retiredAt", "is", null)
    .execute();
  for (const region of regions) {
    await sql`select pg_advisory_xact_lock(hashtext(${region.id}))`.execute(
      transaction,
    );
    const existing = await transaction
      .selectFrom("event_region_review_round")
      .select("id")
      .where("eventOccurrenceRegionId", "=", region.id)
      .executeTakeFirst();
    if (existing) continue;
    await transaction
      .insertInto("event_region_review_round")
      .values({
        id: `event_region_review_round_${randomUUID()}`,
        eventOccurrenceRegionId: region.id,
        round: 1,
        registrationClosesAt: occurrence.registrationClosesAt,
        coordinatorLockAt: occurrence.coordinatorLockAt,
        lockedAt: null,
        lockedByUserId: null,
        lockSource: null,
      })
      .execute();
  }
}

export async function refreshEventOperationalCommunicationSchedules(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
  now: Date,
): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(${`event-operational-communication-schedules:${eventOccurrenceId}`}))`.execute(
    transaction,
  );
  const occurrence = await transaction
    .selectFrom("event_occurrence")
    .select("status")
    .where("id", "=", eventOccurrenceId)
    .executeTakeFirstOrThrow();
  if (occurrence.status === "published")
    await ensureInitialReviewRounds(transaction, eventOccurrenceId);

  const rounds = await transaction
    .selectFrom("event_region_review_round as review")
    .innerJoin(
      "event_occurrence_region as region",
      "region.id",
      "review.eventOccurrenceRegionId",
    )
    .select([
      "review.id",
      "review.eventOccurrenceRegionId",
      "review.round",
      "review.registrationClosesAt",
      "review.coordinatorLockAt",
      "review.lockedAt",
    ])
    .where("region.eventOccurrenceId", "=", eventOccurrenceId)
    .where("region.retiredAt", "is", null)
    .orderBy("review.eventOccurrenceRegionId")
    .orderBy("review.round", "desc")
    .execute();
  const currentByRegion = new Map<string, (typeof rounds)[number]>();
  for (const round of rounds)
    if (!currentByRegion.has(round.eventOccurrenceRegionId))
      currentByRegion.set(round.eventOccurrenceRegionId, round);
  const currentRoundIds = new Set(
    [...currentByRegion.values()].map((round) => round.id),
  );

  const activeSchedules = await transaction
    .selectFrom("event_operational_communication_schedule")
    .select(["id", "eventRegionReviewRoundId"])
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("status", "in", ["pending", "processing"])
    .forUpdate()
    .execute();
  for (const active of activeSchedules)
    if (
      occurrence.status !== "published" ||
      !currentRoundIds.has(active.eventRegionReviewRoundId)
    )
      await transaction
        .updateTable("event_operational_communication_schedule")
        .set({ status: "superseded", supersededAt: now, updatedAt: now })
        .where("id", "=", active.id)
        .executeTakeFirstOrThrow();
  if (occurrence.status !== "published") return;

  for (const round of currentByRegion.values()) {
    for (const definition of [
      {
        kind: "regional_review_due" as const,
        dueAt: round.registrationClosesAt,
      },
      { kind: "regional_lock_due" as const, dueAt: round.coordinatorLockAt },
    ]) {
      const logicalId = `${round.id}:${definition.kind}`;
      const schedules = await transaction
        .selectFrom("event_operational_communication_schedule")
        .selectAll()
        .where("logicalId", "=", logicalId)
        .orderBy("revision", "desc")
        .forUpdate()
        .execute();
      const active = schedules.find((schedule) =>
        (["pending", "processing"] as const).includes(schedule.status as never),
      );
      const completed = schedules.some(
        (schedule) => schedule.status === "completed",
      );
      if (round.lockedAt || completed) {
        if (active)
          await transaction
            .updateTable("event_operational_communication_schedule")
            .set({ status: "superseded", supersededAt: now, updatedAt: now })
            .where("id", "=", active.id)
            .executeTakeFirstOrThrow();
        continue;
      }
      if (active?.dueAt.getTime() === definition.dueAt.getTime()) continue;
      if (active)
        await transaction
          .updateTable("event_operational_communication_schedule")
          .set({ status: "superseded", supersededAt: now, updatedAt: now })
          .where("id", "=", active.id)
          .executeTakeFirstOrThrow();
      await transaction
        .insertInto("event_operational_communication_schedule")
        .values({
          id: `event_operational_communication_schedule_${randomUUID()}`,
          logicalId,
          revision: (schedules[0]?.revision ?? 0) + 1,
          eventOccurrenceId,
          eventRegionReviewRoundId: round.id,
          kind: definition.kind,
          dueAt: definition.dueAt,
          status: "pending",
          attempts: 0,
          availableAt: definition.dueAt,
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
}

export async function supersedeEventOperationalCommunicationSchedules(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
  now: Date,
  eventRegionReviewRoundId?: string,
): Promise<void> {
  let query = transaction
    .updateTable("event_operational_communication_schedule")
    .set({ status: "superseded", supersededAt: now, updatedAt: now })
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("status", "in", ["pending", "processing"]);
  if (eventRegionReviewRoundId)
    query = query.where(
      "eventRegionReviewRoundId",
      "=",
      eventRegionReviewRoundId,
    );
  await query.execute();
}

async function regionalRecipients(
  transaction: Transaction<Database>,
  input: {
    eventOccurrenceId: string;
    eventOccurrenceRegionId: string;
    audience: "administrators" | "coordinators";
  },
): Promise<Array<EventNotificationRecipient>> {
  const rows =
    input.audience === "administrators"
      ? await transaction
          .selectFrom("event_admin_assignment as assignment")
          .innerJoin("user", "user.id", "assignment.userId")
          .select(["user.id as userId", "user.name", "user.email"])
          .where("assignment.eventOccurrenceId", "=", input.eventOccurrenceId)
          .where("assignment.endedAt", "is", null)
          .execute()
      : await transaction
          .selectFrom("event_coordinator_assignment as assignment")
          .innerJoin("user", "user.id", "assignment.userId")
          .select(["user.id as userId", "user.name", "user.email"])
          .where(
            "assignment.eventOccurrenceRegionId",
            "=",
            input.eventOccurrenceRegionId,
          )
          .where("assignment.endedAt", "is", null)
          .execute();
  return [...new Map(rows.map((row) => [row.userId, row])).values()].map(
    (row) => ({ ...row, registrationId: null, participationId: null }),
  );
}

async function reviewContext(
  transaction: Transaction<Database>,
  reviewRoundId: string,
) {
  return await transaction
    .selectFrom("event_region_review_round as review")
    .innerJoin(
      "event_occurrence_region as occurrenceRegion",
      "occurrenceRegion.id",
      "review.eventOccurrenceRegionId",
    )
    .innerJoin(
      "coordination_region as region",
      "region.id",
      "occurrenceRegion.regionId",
    )
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "occurrenceRegion.eventOccurrenceId",
    )
    .select([
      "review.id",
      "review.eventOccurrenceRegionId",
      "review.round",
      "review.registrationClosesAt",
      "review.coordinatorLockAt",
      "review.lockedAt",
      "review.lockSource",
      "occurrence.id as eventOccurrenceId",
      "occurrence.status as eventStatus",
      "region.name as regionName",
    ])
    .where("review.id", "=", reviewRoundId)
    .executeTakeFirstOrThrow();
}

async function enqueueReviewNotifications(
  transaction: Transaction<Database>,
  input: {
    reviewRoundId: string;
    kind: "regional_review_due" | "regional_list_locked";
    anchorAt: Date;
    lockSource?: "administrator" | "deadline" | "manual";
    deduplicationPrefix: string;
    createdAt: Date;
  },
): Promise<number> {
  const review = await reviewContext(transaction, input.reviewRoundId);
  const registrations = await transaction
    .selectFrom("event_registration")
    .select("status")
    .where("reviewRoundId", "=", review.id)
    .execute();
  const pendingCount = registrations.filter(
    (registration) => registration.status === "submitted",
  ).length;
  if (input.kind === "regional_review_due" && pendingCount === 0) return 0;
  const audience =
    input.kind === "regional_review_due" ? "coordinators" : "administrators";
  const recipients = await regionalRecipients(transaction, {
    eventOccurrenceId: review.eventOccurrenceId,
    eventOccurrenceRegionId: review.eventOccurrenceRegionId,
    audience,
  });
  for (const recipient of recipients) {
    const variables = await buildEventNotificationVariables(transaction, {
      eventOccurrenceId: review.eventOccurrenceId,
      communication: {
        id: `system:${input.kind}:${review.id}`,
        sectionId: null,
        sessionDefinitionId: null,
      },
      recipient,
    });
    variables["event.reviewRegionName"] = review.regionName;
    variables["event.reviewPendingCount"] = String(pendingCount);
    variables["event.reviewRegistrationCount"] = String(registrations.length);
    variables["event.reviewLockSource"] =
      input.lockSource === "deadline" ? "at the review deadline" : "manually";
    if (audience === "coordinators") {
      const platformHomeUrl = variables["platform.homeUrl"];
      if (!platformHomeUrl)
        throw new Error("EVENT_NOTIFICATION_HOME_URL_MISSING");
      variables["event.operationsUrl"] =
        `${platformHomeUrl}/event-operations/${review.eventOccurrenceId}`;
    }
    await enqueueSystemEventNotification(transaction, {
      systemKey:
        input.kind === "regional_review_due"
          ? "event_regional_review_due"
          : "event_regional_list_locked",
      recipient,
      deduplicationKey: `${input.deduplicationPrefix}:${recipient.userId}`,
      eventOccurrenceId: review.eventOccurrenceId,
      trigger: input.kind,
      audience,
      eventRegionReviewRoundId: review.id,
      anchorAt: input.anchorAt,
      variables,
      createdAt: input.createdAt,
    });
  }
  return recipients.length;
}

export async function enqueueRegionalListLockedNotifications(
  transaction: Transaction<Database>,
  input: {
    eventOccurrenceId: string;
    eventRegionReviewRoundId: string;
    lockedAt: Date;
    lockSource: "administrator" | "deadline" | "manual";
    createdAt: Date;
  },
): Promise<number> {
  await supersedeEventOperationalCommunicationSchedules(
    transaction,
    input.eventOccurrenceId,
    input.createdAt,
    input.eventRegionReviewRoundId,
  );
  return await enqueueReviewNotifications(transaction, {
    reviewRoundId: input.eventRegionReviewRoundId,
    kind: "regional_list_locked",
    anchorAt: input.lockedAt,
    lockSource: input.lockSource,
    deduplicationPrefix: `event-regional-list-locked:${input.eventRegionReviewRoundId}:${input.lockedAt.toISOString()}`,
    createdAt: input.createdAt,
  });
}

async function materializeOperationalSchedule(
  transaction: Transaction<Database>,
  schedule: {
    id: string;
    eventOccurrenceId: string;
    eventRegionReviewRoundId: string;
    kind: "regional_lock_due" | "regional_review_due";
    dueAt: Date;
  },
  now: Date,
): Promise<number> {
  const review = await reviewContext(
    transaction,
    schedule.eventRegionReviewRoundId,
  );
  if (review.eventStatus !== "published") return 0;
  const latest = await transaction
    .selectFrom("event_region_review_round")
    .select("id")
    .where("eventOccurrenceRegionId", "=", review.eventOccurrenceRegionId)
    .orderBy("round", "desc")
    .executeTakeFirst();
  if (latest?.id !== review.id) return 0;
  if (schedule.kind === "regional_review_due") {
    if (
      review.lockedAt ||
      review.registrationClosesAt.getTime() !== schedule.dueAt.getTime() ||
      review.coordinatorLockAt <= now
    )
      return 0;
    return await enqueueReviewNotifications(transaction, {
      reviewRoundId: review.id,
      kind: "regional_review_due",
      anchorAt: review.registrationClosesAt,
      deduplicationPrefix: schedule.id,
      createdAt: now,
    });
  }
  if (
    review.lockedAt ||
    review.coordinatorLockAt.getTime() !== schedule.dueAt.getTime() ||
    review.coordinatorLockAt > now
  )
    return 0;
  const locked = await transaction
    .updateTable("event_region_review_round")
    .set({ lockedAt: now, lockedByUserId: null, lockSource: "deadline" })
    .where("id", "=", review.id)
    .where("lockedAt", "is", null)
    .returning("id")
    .executeTakeFirst();
  if (!locked) return 0;
  await recordDurableAuditEvent(transaction, {
    actorUserId: null,
    action: "event_region_review.locked",
    subjectType: "event_region_review_round",
    subjectId: review.id,
    aggregateId: review.eventOccurrenceId,
    metadata: { source: "deadline" },
    createdAt: now,
  });
  return await enqueueReviewNotifications(transaction, {
    reviewRoundId: review.id,
    kind: "regional_list_locked",
    anchorAt: now,
    lockSource: "deadline",
    deduplicationPrefix: schedule.id,
    createdAt: now,
  });
}

export async function processNextEventOperationalCommunicationSchedule(
  now = new Date(),
): Promise<EventOperationalScheduleOutcome> {
  const database = getDatabase();
  const claimed = await database.transaction().execute(async (transaction) => {
    const schedule = await transaction
      .selectFrom("event_operational_communication_schedule")
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
      .updateTable("event_operational_communication_schedule")
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
          .selectFrom("event_operational_communication_schedule")
          .select([
            "id",
            "eventOccurrenceId",
            "eventRegionReviewRoundId",
            "kind",
            "dueAt",
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
        const count = await materializeOperationalSchedule(
          transaction,
          schedule,
          now,
        );
        await transaction
          .updateTable("event_operational_communication_schedule")
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
  } catch {
    const failed = claimed.attempt >= MAX_SCHEDULE_ATTEMPTS;
    const delaySeconds = Math.min(30 * 2 ** (claimed.attempt - 1), 15 * 60);
    await database
      .updateTable("event_operational_communication_schedule")
      .set({
        status: failed ? "failed" : "pending",
        availableAt: new Date(now.getTime() + delaySeconds * 1_000),
        lastErrorCode: "EVENT_OPERATIONAL_COMMUNICATION_SCHEDULE_FAILED",
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
