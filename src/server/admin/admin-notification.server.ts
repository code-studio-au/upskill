import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type {
  AdminNotificationOperations,
  AdminNotificationSearch,
} from "#/features/admin-notification/admin-notification.schema";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { NOTIFICATION_DELIVERY_TOPIC } from "#/server/queue/work-message";

const PAGE_SIZE = 20;
const statusLabels = {
  pending: "Pending",
  processing: "Processing",
  delivered: "Delivered",
  failed: "Failed",
  superseded: "Superseded",
} as const;

function searchPattern(query: string): string {
  return `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

export async function findAdminNotificationOperations(
  input: AdminNotificationSearch,
): Promise<AdminNotificationOperations> {
  const database = getDatabase();
  const now = new Date();
  const staleBefore = new Date(
    now.getTime() - getServerEnv().SQS_VISIBILITY_TIMEOUT_SECONDS * 1_000,
  );
  const pattern = searchPattern(input.q);
  const status = input.status === "all" ? undefined : input.status;
  const [notificationHealth, scheduleHealth, outboxHealth, countRow] =
    await Promise.all([
      database
        .selectFrom("notification")
        .select([
          sql<number>`count(*) filter (where status = 'pending')::integer`.as(
            "pending",
          ),
          sql<number>`count(*) filter (where status = 'failed')::integer`.as(
            "failed",
          ),
          sql<number>`count(*) filter (
            where status = 'processing' and "updatedAt" <= ${staleBefore}
          )::integer`.as("staleProcessing"),
          sql<Date | null>`min("createdAt") filter (where status = 'pending')`.as(
            "oldestPendingAt",
          ),
        ])
        .executeTakeFirstOrThrow(),
      database
        .selectFrom("event_communication_schedule")
        .select([
          sql<number>`count(*) filter (where status in ('pending', 'processing'))::integer`.as(
            "active",
          ),
          sql<number>`count(*) filter (
            where status in ('pending', 'processing') and "dueAt" <= ${now}
          )::integer`.as("overdue"),
          sql<number>`count(*) filter (where status = 'failed')::integer`.as(
            "failed",
          ),
          sql<Date | null>`min("dueAt") filter (
            where status in ('pending', 'processing') and "dueAt" <= ${now}
          )`.as("oldestOverdueAt"),
        ])
        .executeTakeFirstOrThrow(),
      database
        .selectFrom("outbox_event")
        .where("topic", "=", NOTIFICATION_DELIVERY_TOPIC)
        .where("processedAt", "is", null)
        .select([
          sql<number>`count(*)::integer`.as("pending"),
          sql<number>`count(*) filter (where "availableAt" <= ${now})::integer`.as(
            "due",
          ),
          sql<Date | null>`min("availableAt") filter (where "availableAt" <= ${now})`.as(
            "oldestDueAt",
          ),
        ])
        .executeTakeFirstOrThrow(),
      database
        .selectFrom("notification")
        .$if(status !== undefined, (query) =>
          query.where("notification.status", "=", status ?? "pending"),
        )
        .$if(input.q.length > 0, (query) =>
          query.where((expression) =>
            expression.or([
              expression("notification.recipientName", "ilike", pattern),
              expression("notification.recipientEmail", "ilike", pattern),
              expression("notification.renderedSubject", "ilike", pattern),
            ]),
          ),
        )
        .select(sql<number>`count(*)::integer`.as("count"))
        .executeTakeFirstOrThrow(),
    ]);

  const pages = Math.max(1, Math.ceil(countRow.count / PAGE_SIZE));
  const page = Math.min(input.page, pages);
  const rows = await database
    .selectFrom("notification")
    .$if(status !== undefined, (query) =>
      query.where("notification.status", "=", status ?? "pending"),
    )
    .$if(input.q.length > 0, (query) =>
      query.where((expression) =>
        expression.or([
          expression("notification.recipientName", "ilike", pattern),
          expression("notification.recipientEmail", "ilike", pattern),
          expression("notification.renderedSubject", "ilike", pattern),
        ]),
      ),
    )
    .select([
      "notification.id",
      "notification.templateKey",
      sql<string | null>`notification.payload ->> 'trigger'`.as(
        "communicationTrigger",
      ),
      "notification.recipientName",
      "notification.recipientEmail",
      "notification.status",
      "notification.attempts",
      "notification.lastErrorCode",
      "notification.renderedSubject",
      "notification.createdAt",
      "notification.updatedAt",
      "notification.deliveredAt",
      "notification.supersededAt",
      sql<Date | null>`(
        select min(outbox."availableAt")
        from outbox_event outbox
        where outbox.topic = ${NOTIFICATION_DELIVERY_TOPIC}
          and outbox."aggregateId" = notification.id
          and outbox."processedAt" is null
      )`.as("scheduledFor"),
    ])
    .orderBy("notification.createdAt", "desc")
    .orderBy("notification.id", "desc")
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)
    .execute();
  const notificationIds = rows.map((row) => row.id);
  const attempts =
    notificationIds.length === 0
      ? []
      : await database
          .selectFrom("notification_delivery_attempt")
          .selectAll()
          .where("notificationId", "in", notificationIds)
          .orderBy("notificationId")
          .orderBy("attempt", "desc")
          .execute();
  const attemptsByNotification = Map.groupBy(
    attempts,
    (attempt) => attempt.notificationId,
  );

  return {
    healthSummary: `Pending ${String(notificationHealth.pending)} · Failed ${String(notificationHealth.failed)} · Stale ${String(notificationHealth.staleProcessing)} · Overdue schedules ${String(scheduleHealth.overdue)} · Failed schedules ${String(scheduleHealth.failed)} · Due outbox ${String(outboxHealth.due)}`,
    oldestSummary: `Oldest overdue schedule ${scheduleHealth.oldestOverdueAt?.toISOString().slice(0, 16).replace("T", " ") ?? "None"} · Oldest due outbox ${outboxHealth.oldestDueAt?.toISOString().slice(0, 16).replace("T", " ") ?? "None"}`,
    health: {
      pendingNotifications: notificationHealth.pending,
      failedNotifications: notificationHealth.failed,
      staleProcessingNotifications: notificationHealth.staleProcessing,
      activeSchedules: scheduleHealth.active,
      overdueSchedules: scheduleHealth.overdue,
      failedSchedules: scheduleHealth.failed,
      pendingDeliveryOutbox: outboxHealth.pending,
      dueDeliveryOutbox: outboxHealth.due,
      oldestPendingNotificationAt:
        notificationHealth.oldestPendingAt?.toISOString() ?? null,
      oldestOverdueScheduleAt:
        scheduleHealth.oldestOverdueAt?.toISOString() ?? null,
      oldestDueOutboxAt: outboxHealth.oldestDueAt?.toISOString() ?? null,
    },
    notifications: rows.map((row) => {
      const isScheduled =
        row.status === "pending" &&
        row.scheduledFor !== null &&
        row.scheduledFor > now;
      const deliveryAttempts = (attemptsByNotification.get(row.id) ?? []).map(
        (attempt) => ({
          ...attempt,
          createdAt: attempt.createdAt.toISOString(),
        }),
      );
      const deliverySummary = `${(row.communicationTrigger ?? row.templateKey).replaceAll("_", " ")} · ${isScheduled && row.scheduledFor ? `Scheduled for ${row.scheduledFor.toISOString().slice(0, 16).replace("T", " ")} UTC` : `Attempts ${String(row.attempts)} · Updated ${row.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`}`;
      const attemptSummary = deliveryAttempts
        .map(
          (attempt) =>
            `#${String(attempt.attempt)} · ${attempt.provider} · ${attempt.status}${attempt.errorCode ? ` · ${attempt.errorCode}` : ""}`,
        )
        .join("\n");
      return {
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
        supersededAt: row.supersededAt?.toISOString() ?? null,
        scheduledFor: row.scheduledFor?.toISOString() ?? null,
        statusLabel: isScheduled ? "Scheduled" : statusLabels[row.status],
        deliveryAttempts,
        detailSummary: `Email\n${row.recipientEmail}\n\nSubject\n${row.renderedSubject ?? "Renders when delivery begins"}\n\nDelivery details\n${deliverySummary}\n\nLast error\n${row.lastErrorCode ?? "None"}\n\nProvider attempt history\n${attemptSummary || "None recorded"}`,
      };
    }),
    pagination: { page, pages, total: countRow.count, pageSize: PAGE_SIZE },
    query: input.q,
    status: input.status,
  };
}

export async function requeueFailedNotification(
  notificationId: string,
  administrator: AuthenticatedUser,
): Promise<"requeued" | "not-found" | "conflict"> {
  const database = getDatabase();
  return await database.transaction().execute(async (transaction) => {
    const notification = await transaction
      .selectFrom("notification")
      .select(["id", "status", "attempts", "lastErrorCode"])
      .where("id", "=", notificationId)
      .forUpdate()
      .executeTakeFirst();
    if (!notification) return "not-found";
    if (notification.status !== "failed") return "conflict";

    const requeuedAt = new Date();
    await transaction
      .updateTable("notification")
      .set({ status: "pending", lastErrorCode: null, updatedAt: requeuedAt })
      .where("id", "=", notification.id)
      .where("status", "=", "failed")
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto("outbox_event")
      .values({
        id: `outbox_${randomUUID()}`,
        topic: NOTIFICATION_DELIVERY_TOPIC,
        aggregateId: notification.id,
        payload: { notificationId: notification.id },
        availableAt: requeuedAt,
        processedAt: null,
        createdAt: requeuedAt,
      })
      .execute();
    await recordDurableAuditEvent(transaction, {
      actorUserId: administrator.id,
      action: "notification.delivery_requeued",
      subjectType: "notification",
      subjectId: notification.id,
      metadata: {
        priorAttempts: notification.attempts,
        priorErrorCode: notification.lastErrorCode,
      },
      createdAt: requeuedAt,
    });
    return "requeued";
  });
}
