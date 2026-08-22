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
    const preview = await previewOfferingCommunication(data.scope, {
      ...(data.communicationId
        ? { communicationId: data.communicationId }
        : {}),
      ...(data.emailDesignVersionId
        ? { emailDesignVersionId: data.emailDesignVersionId }
        : {}),
      ...(data.subject ? { subject: data.subject } : {}),
      ...(data.textBody ? { textBody: data.textBody } : {}),
      ...(data.offeringTitle ? { offeringTitle: data.offeringTitle } : {}),
      ...(data.sectionTitle ? { sectionTitle: data.sectionTitle } : {}),
      ...(data.sessionTitle ? { sessionTitle: data.sessionTitle } : {}),
    });
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
    const outcome =
      data.action === "override_occurrence"
        ? await communication.overrideOccurrenceCommunication(
            data.payload,
            request.user,
          )
        : await communication.resetOccurrenceCommunication(
            data.payload,
            request.user,
          );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "conflict")
      return { status: "conflict", reason: "invalid_plan" };
    return { status: "ready", data: null };
  });
