import { createServerFn } from "@tanstack/react-start";
import {
  adminEventOccurrenceFormSchema,
  adminEventOccurrenceParamsSchema,
  adminEventOccurrenceUpdateFormSchema,
  adminEventTemplateDraftSchema,
  adminEventTemplateParamsSchema,
  adminEventTemplateVersionParamsSchema,
  type AdminEventMutationResult,
  type AdminEventResult,
  type AdminEventTemplateDetailResult,
  type AdminEventWorkspace,
} from "#/features/admin-event/admin-event.schema";

export const getAdminEventWorkspace = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminEventResult<AdminEventWorkspace>> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminEventWorkspace } =
      await import("#/server/admin/admin-event.server");
    return { status: "ready", data: await findAdminEventWorkspace() };
  },
);

export const getAdminEventTemplate = createServerFn({ method: "GET" })
  .validator(adminEventTemplateParamsSchema)
  .handler(async ({ data }): Promise<AdminEventTemplateDetailResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminEventTemplate } =
      await import("#/server/admin/admin-event.server");
    const detail = await findAdminEventTemplate(data.eventTemplateId);
    return detail ? { status: "ready", data: detail } : { status: "not-found" };
  });

export const startAdminEventTemplate = createServerFn({
  method: "POST",
}).handler(async (): Promise<AdminEventMutationResult> => {
  const { getAdministratorRequest } =
    await import("#/server/admin/admin-access.server");
  const request = await getAdministratorRequest();
  if (request.status !== "ready") return request;
  const { startAdminEventTemplate: startTemplate } =
    await import("#/server/admin/admin-event.server");
  const outcome = await startTemplate(request.user);
  if (outcome.status === "conflict")
    return { status: "conflict", reason: "template_not_publishable" };
  return {
    status: "ready",
    data: {
      outcome: "template-created",
      eventTemplateId: outcome.eventTemplateId,
      eventTemplateVersionId: outcome.eventTemplateVersionId,
    },
  };
});

export const publishAdminEventTemplate = createServerFn({ method: "POST" })
  .validator(adminEventTemplateVersionParamsSchema)
  .handler(async ({ data }): Promise<AdminEventMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { publishAdminEventTemplateVersion } =
      await import("#/server/admin/admin-event.server");
    const outcome = await publishAdminEventTemplateVersion(
      data.eventTemplateId,
      data.eventTemplateVersionId,
      request.user,
    );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "conflict")
      return { status: "conflict", reason: "template_not_publishable" };
    return {
      status: "ready",
      data: {
        outcome: "template-published",
        eventTemplateId: data.eventTemplateId,
        eventTemplateVersionId: data.eventTemplateVersionId,
      },
    };
  });

export const saveAdminEventTemplate = createServerFn({ method: "POST" })
  .validator(adminEventTemplateDraftSchema)
  .handler(async ({ data }): Promise<AdminEventMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { saveAdminEventTemplateDraft } =
      await import("#/server/admin/admin-event.server");
    const outcome = await saveAdminEventTemplateDraft(data, request.user);
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "conflict")
      return { status: "conflict", reason: "template_not_publishable" };
    return {
      status: "ready",
      data: {
        outcome: "template-saved",
        eventTemplateId: data.eventTemplateId,
        eventTemplateVersionId: data.eventTemplateVersionId,
      },
    };
  });

export const createAdminEventVersion = createServerFn({ method: "POST" })
  .validator(adminEventTemplateParamsSchema)
  .handler(async ({ data }): Promise<AdminEventMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { createAdminEventTemplateVersion } =
      await import("#/server/admin/admin-event.server");
    const outcome = await createAdminEventTemplateVersion(
      data.eventTemplateId,
      request.user,
    );
    if (outcome.status !== "created") {
      if (outcome.status === "not-found") return { status: "not-found" };
      return { status: "conflict", reason: "template_not_publishable" };
    }
    return {
      status: "ready",
      data: {
        outcome: "template-version-created",
        eventTemplateId: data.eventTemplateId,
        eventTemplateVersionId: outcome.eventTemplateVersionId,
      },
    };
  });

export const createAdminEventOccurrence = createServerFn({ method: "POST" })
  .validator(adminEventOccurrenceFormSchema)
  .handler(async ({ data }): Promise<AdminEventMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const [
      { createAdminEventOccurrence: createOccurrence },
      { convertAdminEventOccurrenceForm },
    ] = await Promise.all([
      import("#/server/admin/admin-event.server"),
      import("#/server/admin/event-timezone.server"),
    ]);
    const occurrence = convertAdminEventOccurrenceForm(data);
    if (!occurrence)
      return { status: "conflict", reason: "occurrence_not_publishable" };
    const outcome = await createOccurrence(occurrence, request.user);
    if (outcome.status === "not-found") return { status: "not-found" };
    if (outcome.status === "slug-in-use")
      return { status: "conflict", reason: "slug_in_use" };
    if (outcome.status === "conflict")
      return { status: "conflict", reason: "occurrence_not_publishable" };
    return {
      status: "ready",
      data: {
        outcome: "occurrence-created",
        eventOccurrenceId: outcome.eventOccurrenceId,
      },
    };
  });

export const updateAdminEventOccurrence = createServerFn({ method: "POST" })
  .validator(adminEventOccurrenceUpdateFormSchema)
  .handler(async ({ data }): Promise<AdminEventMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const [
      { updateAdminEventOccurrence: updateOccurrence },
      { convertAdminEventOccurrenceForm },
    ] = await Promise.all([
      import("#/server/admin/admin-event.server"),
      import("#/server/admin/event-timezone.server"),
    ]);
    const occurrence = convertAdminEventOccurrenceForm(data.occurrence);
    if (!occurrence)
      return { status: "conflict", reason: "occurrence_not_publishable" };
    const outcome = await updateOccurrence(
      data.eventOccurrenceId,
      occurrence,
      request.user,
    );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "slug-in-use")
      return { status: "conflict", reason: "slug_in_use" };
    if (outcome === "conflict")
      return { status: "conflict", reason: "occurrence_not_publishable" };
    return {
      status: "ready",
      data: {
        outcome: "occurrence-updated",
        eventOccurrenceId: data.eventOccurrenceId,
      },
    };
  });

export const publishAdminEventOccurrence = createServerFn({ method: "POST" })
  .validator(adminEventOccurrenceParamsSchema)
  .handler(async ({ data }): Promise<AdminEventMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { publishAdminEventOccurrence: publishOccurrence } =
      await import("#/server/admin/admin-event.server");
    const outcome = await publishOccurrence(
      data.eventOccurrenceId,
      request.user,
    );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "conflict")
      return { status: "conflict", reason: "occurrence_not_publishable" };
    return {
      status: "ready",
      data: {
        outcome: "occurrence-published",
        eventOccurrenceId: data.eventOccurrenceId,
      },
    };
  });
