import { createServerFn } from "@tanstack/react-start";
import {
  adminCommunicationMutationSchema,
  communicationScopeSchema,
  previewCommunicationSchema,
  type AdminCommunicationResult,
  type AdminCommunicationWorkspace,
} from "#/features/admin-email/admin-communication.schema";
import type { AdminEmailPreviewResult } from "#/features/admin-email/admin-email.schema";

async function administratorRequest() {
  const { getAdministratorRequest } =
    await import("#/server/admin/admin-access.server");
  return await getAdministratorRequest();
}

export const getAdminCommunicationWorkspace = createServerFn({ method: "GET" })
  .validator(communicationScopeSchema)
  .handler(
    async ({
      data,
    }): Promise<AdminCommunicationResult<AdminCommunicationWorkspace>> => {
      const request = await administratorRequest();
      if (request.status !== "ready") return request;
      const { findAdminCommunicationWorkspace } =
        await import("#/server/admin/admin-communication.server");
      const workspace = await findAdminCommunicationWorkspace(data);
      return workspace
        ? { status: "ready", data: workspace }
        : { status: "not-found" };
    },
  );

export const previewAdminCommunication = createServerFn({ method: "POST" })
  .validator(previewCommunicationSchema)
  .handler(async ({ data }): Promise<AdminEmailPreviewResult> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const { previewOfferingCommunication } =
      await import("#/server/admin/admin-communication.server");
    const preview = await previewOfferingCommunication(
      data.scope,
      data.communicationId,
    );
    return preview
      ? { status: "ready", data: preview }
      : { status: "conflict", reason: "invalid_template" };
  });

export const mutateAdminCommunication = createServerFn({
  method: "POST",
})
  .validator(adminCommunicationMutationSchema)
  .handler(async ({ data }): Promise<AdminCommunicationResult<null>> => {
    const request = await administratorRequest();
    if (request.status !== "ready") return request;
    const communication =
      await import("#/server/admin/admin-communication.server");
    let outcome;
    if (data.action === "save_course") {
      const { communicationId, ...plan } = data.payload;
      outcome = await communication.saveCourseCommunicationPlan(
        { ...plan, ...(communicationId ? { communicationId } : {}) },
        request.user,
      );
    } else if (data.action === "save_event_template") {
      const { communicationId, ...plan } = data.payload;
      outcome = await communication.saveEventTemplateCommunicationPlan(
        { ...plan, ...(communicationId ? { communicationId } : {}) },
        request.user,
      );
    } else if (data.action === "delete") {
      outcome = await communication.deleteCommunicationPlan(
        data.payload,
        request.user,
      );
    } else if (data.action === "override_occurrence") {
      outcome = await communication.overrideOccurrenceCommunication(
        data.payload,
        request.user,
      );
    } else {
      outcome = await communication.resetOccurrenceCommunication(
        data.payload,
        request.user,
      );
    }
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "conflict")
      return { status: "conflict", reason: "invalid_plan" };
    return { status: "ready", data: null };
  });
