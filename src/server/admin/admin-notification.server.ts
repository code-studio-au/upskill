import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type {
  AdminNotificationOperations,
  AdminNotificationSearch,
  NotificationStatus,
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
  accepted: "Accepted",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
  superseded: "Superseded",
  unknown: "Unknown",
} as const;

function searchPattern(query: string): string {
  return `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function deliverySource(database: ReturnType<typeof getDatabase>) {
  const email = database.selectFrom("notification").select([
    "notification.id",
    sql<"email" | "sms">`'email'`.as("channel"),
    sql<string>`coalesce(notification.payload ->> 'purpose', notification.payload ->> 'trigger', notification."templateKey")`.as(
      "purpose",
    ),
    "notification.recipientName",
    "notification.recipientEmail as recipientAddress",
    sql<string>`notification.status`.as("status"),
    "notification.attempts",
    "notification.lastErrorCode",
    sql<string | null>`coalesce(
      notification."renderedSubject",
      notification."subjectTemplateSnapshot" || ' (template; renders when delivery begins)'
    )`.as("subject"),
    sql<Date | null>`(
      select min(outbox."availableAt")
      from outbox_event outbox
      where outbox.topic = ${NOTIFICATION_DELIVERY_TOPIC}
        and outbox."aggregateId" = notification.id
        and outbox."processedAt" is null
    )`.as("scheduledFor"),
    sql<string | null>`null`.as("provider"),
    sql<string | null>`null`.as("providerBatchId"),
    sql<Date | null>`null`.as("acceptedAt"),
    sql<Date | null>`null`.as("sentAt"),
    "notification.deliveredAt",
    sql<Date | null>`case when notification.status = 'failed' then notification."updatedAt" end`.as(
      "failedAt",
    ),
    "notification.createdAt",
    "notification.updatedAt",
  ]);
  const sms = database
    .selectFrom("sms_delivery as sms")
    .select([
      "sms.id",
      sql<"email" | "sms">`'sms'`.as("channel"),
      "sms.purpose",
      sql<string>`coalesce(sms."recipientNameSnapshot", 'SMS recipient')`.as(
        "recipientName",
      ),
      "sms.recipientPhone as recipientAddress",
      sql<string>`sms.status`.as("status"),
      sql<number>`1`.as("attempts"),
      "sms.lastErrorCode",
      sql<string | null>`null`.as("subject"),
      sql<Date | null>`null`.as("scheduledFor"),
      "sms.provider",
      "sms.providerBatchId",
      "sms.acceptedAt",
      "sms.sentAt",
      "sms.deliveredAt",
      "sms.failedAt",
      "sms.createdAt",
      "sms.updatedAt",
    ]);
  return email.unionAll(sms);
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
  const channel = input.channel === "all" ? undefined : input.channel;
  const filteredDeliveries = () =>
    database
      .selectFrom(deliverySource(database).as("delivery"))
      .$if(status !== undefined, (query) =>
        query.where("delivery.status", "=", status ?? "pending"),
      )
      .$if(channel !== undefined, (query) =>
        query.where("delivery.channel", "=", channel ?? "email"),
      )
      .$if(input.q.length > 0, (query) =>
        query.where((expression) =>
          expression.or([
            expression("delivery.recipientName", "ilike", pattern),
            expression("delivery.recipientAddress", "ilike", pattern),
            expression("delivery.purpose", "ilike", pattern),
            expression("delivery.subject", "ilike", pattern),
            expression("delivery.providerBatchId", "ilike", pattern),
          ]),
        ),
      );
  const [
    notificationHealth,
    scheduleHealth,
    outboxHealth,
    smsHealth,
    countRow,
  ] = await Promise.all([
    database
      .selectFrom("notification")
      .select([
        sql<number>`count(*) filter (where status = 'pending')::integer`.as(
          "pending",
        ),
        sql<number>`count(*) filter (where status = 'failed')::integer`.as(
          "failed",
        ),
        sql<number>`count(*) filter (where status = 'unknown')::integer`.as(
          "unknown",
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
        sql<number>`(
          count(*) filter (where status in ('pending', 'processing'))
          + (select count(*) from event_operational_communication_schedule
             where status in ('pending', 'processing'))
        )::integer`.as("active"),
        sql<number>`(
          count(*) filter (where status in ('pending', 'processing') and "dueAt" <= ${now})
          + (select count(*) from event_operational_communication_schedule
             where status in ('pending', 'processing') and "dueAt" <= ${now})
        )::integer`.as("overdue"),
        sql<number>`(
          count(*) filter (where status = 'failed')
          + (select count(*) from event_operational_communication_schedule
             where status = 'failed')
        )::integer`.as("failed"),
        sql<Date | null>`least(
          min("dueAt") filter (where status in ('pending', 'processing') and "dueAt" <= ${now}),
          (select min("dueAt") from event_operational_communication_schedule
           where status in ('pending', 'processing') and "dueAt" <= ${now})
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
      .selectFrom("sms_delivery")
      .select([
        sql<number>`count(*) filter (where status in ('accepted', 'sent', 'unknown'))::integer`.as(
          "awaitingCarrier",
        ),
        sql<number>`count(*) filter (where status = 'failed')::integer`.as(
          "failed",
        ),
      ])
      .executeTakeFirstOrThrow(),
    filteredDeliveries()
      .select(sql<number>`count(*)::integer`.as("count"))
      .executeTakeFirstOrThrow(),
  ]);

  const pages = Math.max(1, Math.ceil(countRow.count / PAGE_SIZE));
  const page = Math.min(input.page, pages);
  const rows = await filteredDeliveries()
    .selectAll()
    .orderBy("delivery.createdAt", "desc")
    .orderBy("delivery.id", "desc")
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)
    .execute();
  const notificationIds = rows
    .filter((row) => row.channel === "email")
    .map((row) => row.id);
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
    statusOptions: [
      { value: "all", label: "All statuses" },
      { value: "pending", label: "Pending / scheduled" },
      { value: "processing", label: "Processing" },
      { value: "accepted", label: "Accepted by provider" },
      { value: "sent", label: "Sent from device" },
      { value: "delivered", label: "Delivered" },
      { value: "failed", label: "Failed" },
      { value: "superseded", label: "Superseded" },
      { value: "unknown", label: "Unknown" },
    ],
    channelOptions: [
      { value: "all", label: "All channels" },
      { value: "email", label: "Email" },
      { value: "sms", label: "SMS" },
    ],
    healthSummary: `Email pending ${String(notificationHealth.pending)} · Email failed ${String(notificationHealth.failed)} · Email uncertain ${String(notificationHealth.unknown)} · SMS awaiting carrier ${String(smsHealth.awaitingCarrier)} · SMS failed ${String(smsHealth.failed)} · Overdue schedules ${String(scheduleHealth.overdue)} · Due outbox ${String(outboxHealth.due)}`,
    oldestSummary: `Oldest overdue schedule ${scheduleHealth.oldestOverdueAt?.toISOString().slice(0, 16).replace("T", " ") ?? "None"} · Oldest due outbox ${outboxHealth.oldestDueAt?.toISOString().slice(0, 16).replace("T", " ") ?? "None"}`,
    health: {
      pendingNotifications: notificationHealth.pending,
      failedNotifications: notificationHealth.failed,
      uncertainNotifications: notificationHealth.unknown,
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
      smsAwaitingCarrier: smsHealth.awaitingCarrier,
      failedSms: smsHealth.failed,
    },
    notifications: rows.map((row) => {
      const isScheduled =
        row.channel === "email" &&
        row.status === "pending" &&
        row.scheduledFor !== null &&
        row.scheduledFor > now;
      const deliveryAttempts = (attemptsByNotification.get(row.id) ?? []).map(
        (attempt) => ({
          ...attempt,
          createdAt: attempt.createdAt.toISOString(),
        }),
      );
      const deliverySummary = `${row.purpose.replaceAll("_", " ")} · ${isScheduled && row.scheduledFor ? `Scheduled for ${row.scheduledFor.toISOString().slice(0, 16).replace("T", " ")} UTC` : `Attempts ${String(row.attempts)} · Updated ${row.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`}`;
      const attemptSummary = deliveryAttempts
        .map(
          (attempt) =>
            `#${String(attempt.attempt)} · ${attempt.provider} · ${attempt.status}${attempt.errorCode ? ` · ${attempt.errorCode}` : ""}`,
        )
        .join("\n");
      return {
        id: row.id,
        channel: row.channel,
        channelLabel: row.channel === "email" ? "Email" : "SMS",
        recipientName: row.recipientName,
        recipientAddress: row.recipientAddress,
        status: row.status as NotificationStatus,
        attempts: row.attempts,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        statusLabel: isScheduled
          ? "Scheduled"
          : statusLabels[row.status as NotificationStatus],
        canRequeue: row.channel === "email" && row.status === "failed",
        detailSummary:
          row.channel === "email"
            ? `Email\n${row.recipientAddress}\n\nSubject\n${row.subject ?? "Not rendered"}\n\nDelivery details\n${deliverySummary}\n\nLast error\n${row.lastErrorCode ?? "None"}\n\nProvider attempt history\n${attemptSummary || "None recorded"}`
            : `Mobile\n${row.recipientAddress}\n\nPurpose\n${row.purpose.replaceAll("_", " ")}\n\nDelivery details\nProvider ${row.provider ?? "Unknown"}\nBatch ${row.providerBatchId ?? "Not applicable"}\nAccepted ${row.acceptedAt?.toISOString() ?? "Not yet"}\nSent ${row.sentAt?.toISOString() ?? "Not confirmed"}\nDelivered ${row.deliveredAt?.toISOString() ?? "Not confirmed"}\nFailed ${row.failedAt?.toISOString() ?? "No"}\n\nLast error\n${row.lastErrorCode ?? "None"}`,
      };
    }),
    pagination: { page, pages, total: countRow.count, pageSize: PAGE_SIZE },
    query: input.q,
    status: input.status,
    channel: input.channel,
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
