import { z } from "#/validation/zod";

const notificationStatuses = [
  "pending",
  "processing",
  "accepted",
  "sent",
  "delivered",
  "failed",
  "superseded",
  "unknown",
] as const;

export type NotificationStatus = (typeof notificationStatuses)[number];

export const adminNotificationSearchSchema = z.object({
  q: z.catch(z.string().check(z.trim(), z.maxLength(100)), ""),
  status: z.catch(z.enum(["all", ...notificationStatuses]), "all"),
  channel: z.catch(z.enum(["all", "email", "sms"]), "all"),
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

interface AdminNotificationRow {
  id: string;
  channel: "email" | "sms";
  channelLabel: "Email" | "SMS";
  recipientName: string;
  recipientAddress: string;
  status: NotificationStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  statusLabel: string;
  canRequeue: boolean;
  detailSummary: string;
}

export interface AdminNotificationOperations {
  statusOptions: Array<{ value: string; label: string }>;
  channelOptions: Array<{ value: string; label: string }>;
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
    smsAwaitingCarrier: number;
    failedSms: number;
  };
  notifications: Array<AdminNotificationRow>;
  pagination: { page: number; pages: number; total: number; pageSize: number };
  query: string;
  status: "all" | NotificationStatus;
  channel: "all" | "email" | "sms";
}

export type AdminNotificationResult<T> =
  | { status: "ready"; data: T }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export type AdminNotificationRetryResult =
  | AdminNotificationResult<{ outcome: "requeued" }>
  | { status: "not-found" }
  | { status: "conflict"; reason: "notification_not_failed" };
