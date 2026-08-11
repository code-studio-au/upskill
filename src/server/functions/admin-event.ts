import { createServerFn } from "@tanstack/react-start";
import {
  adminEventOccurrenceFormSchema,
  adminEventOccurrenceParamsSchema,
  adminEventTemplateCreateSchema,
  adminEventTemplateVersionParamsSchema,
  type AdminEventMutationResult,
  type AdminEventResult,
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

export const createAdminEventTemplate = createServerFn({ method: "POST" })
  .validator(adminEventTemplateCreateSchema)
  .handler(async ({ data }): Promise<AdminEventMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { createAdminEventTemplate: createTemplate } =
      await import("#/server/admin/admin-event.server");
    const outcome = await createTemplate(data, request.user);
    if (outcome.status === "conflict")
      return { status: "conflict", reason: "slug_in_use" };
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
