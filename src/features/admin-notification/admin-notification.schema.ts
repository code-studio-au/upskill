import { z } from "#/validation/zod";

const notificationStatuses = [
  "pending",
  "processing",
  "delivered",
  "failed",
  "superseded",
] as const;

type NotificationStatus = (typeof notificationStatuses)[number];

export const adminNotificationSearchSchema = z.object({
  q: z.catch(z.string().check(z.trim(), z.maxLength(100)), ""),
  status: z.catch(z.enum(["all", ...notificationStatuses]), "all"),
  page: z.catch(
    z.coerce.number().check(z.int(), z.minimum(1), z.maximum(10_000)),
    1,
  ),
});

export const adminNotificationRetrySchema = z.object({
  notificationId: z
    .string()
    .check(
      z.trim(),
      z.minLength(1),
      z.maxLength(255),
      z.regex(/^[A-Za-z0-9_-]+$/),
    ),
});

export type AdminNotificationSearch = z.infer<
  typeof adminNotificationSearchSchema
>;

interface AdminNotificationAttempt {
  id: string;
  attempt: number;
  provider: string;
  status: "delivered" | "failed";
  providerMessageId: string | null;
  errorCode: string | null;
  createdAt: string;
}

interface AdminNotificationRow {
  id: string;
  templateKey: "account_setup_requested" | "offering_course" | "offering_event";
  recipientName: string;
  recipientEmail: string;
  status: NotificationStatus;
  attempts: number;
  lastErrorCode: string | null;
  renderedSubject: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  supersededAt: string | null;
  scheduledFor: string | null;
  statusLabel: string;
  deliveryAttempts: Array<AdminNotificationAttempt>;
  detailSummary: string;
}

export interface AdminNotificationOperations {
  healthSummary: string;
  oldestSummary: string;
  health: {
    pendingNotifications: number;
    failedNotifications: number;
    staleProcessingNotifications: number;
    activeSchedules: number;
    overdueSchedules: number;
    failedSchedules: number;
    pendingDeliveryOutbox: number;
    dueDeliveryOutbox: number;
    oldestPendingNotificationAt: string | null;
    oldestOverdueScheduleAt: string | null;
    oldestDueOutboxAt: string | null;
  };
  notifications: Array<AdminNotificationRow>;
  pagination: { page: number; pages: number; total: number; pageSize: number };
  query: string;
  status: "all" | NotificationStatus;
}

export type AdminNotificationResult<T> =
  | { status: "ready"; data: T }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export type AdminNotificationRetryResult =
  | AdminNotificationResult<{ outcome: "requeued" }>
  | { status: "not-found" }
  | { status: "conflict"; reason: "notification_not_failed" };
