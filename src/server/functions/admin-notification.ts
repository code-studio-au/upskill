import { createServerFn } from "@tanstack/react-start";
import {
  adminNotificationRetrySchema,
  adminNotificationSearchSchema,
  type AdminNotificationOperations,
  type AdminNotificationResult,
  type AdminNotificationRetryResult,
} from "#/features/admin-notification/admin-notification.schema";

async function administratorRequest() {
  const { getAdministratorRequest } =
    await import("#/server/admin/admin-access.server");
  return await getAdministratorRequest();
}

export const getAdminNotificationOperations = createServerFn({ method: "GET" })
  .validator(adminNotificationSearchSchema)
  .handler(
    async ({
      data,
    }): Promise<AdminNotificationResult<AdminNotificationOperations>> => {
      const request = await administratorRequest();
      if (request.status !== "ready") return request;
      const { findAdminNotificationOperations } =
        await import("#/server/admin/admin-notification.server");
      return {
        status: "ready",
        data: await findAdminNotificationOperations(data),
      };
    },
  );

export const requeueAdminNotification = createServerFn({ method: "POST" })
  .validator(adminNotificationRetrySchema)
  .handler(async ({ data }): Promise<AdminNotificationRetryResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { requeueFailedNotification } =
      await import("#/server/admin/admin-notification.server");
    const outcome = await requeueFailedNotification(
      data.notificationId,
      request.user,
    );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "conflict")
      return { status: "conflict", reason: "notification_not_failed" };
    return { status: "ready", data: { outcome } };
  });
