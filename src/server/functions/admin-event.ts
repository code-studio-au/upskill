import { createServerFn } from "@tanstack/react-start";
import {
  adminCoordinationRegionSaveSchema,
  adminCoordinationRegionStatusSchema,
  adminEventOccurrenceFormSchema,
  adminEventOccurrenceParamsSchema,
  adminEventOccurrenceRescheduleFormSchema,
  adminEventOccurrenceUpdateFormSchema,
  adminEventStaffCandidateSearchSchema,
  adminEventStaffEligibilityGrantSchema,
  adminEventStaffEligibilityParamsSchema,
  adminEventTemplateDraftSchema,
  adminEventTemplateParamsSchema,
  adminEventTemplateVersionParamsSchema,
  type AdminEventMutationResult,
  type AdminEventPersonOption,
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

export const saveAdminCoordinationRegion = createServerFn({ method: "POST" })
  .validator(adminCoordinationRegionSaveSchema)
  .handler(async ({ data }): Promise<AdminEventMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { saveAdminCoordinationRegion: saveRegion } =
      await import("#/server/admin/admin-event.server");
    const outcome = await saveRegion(data, request.user);
    if (!("regionId" in outcome)) {
      if (outcome.status === "not-found") return { status: "not-found" };
      return {
        status: "conflict",
        reason:
          outcome.status === "code-in-use"
            ? "region_code_in_use"
            : "region_not_retirable",
      };
    }
    return {
      status: "ready",
      data: {
        outcome:
          outcome.status === "created" ? "region-created" : "region-updated",
        regionId: outcome.regionId,
      },
    };
  });

export const setAdminCoordinationRegionStatus = createServerFn({
  method: "POST",
})
  .validator(adminCoordinationRegionStatusSchema)
  .handler(async ({ data }): Promise<AdminEventMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { setAdminCoordinationRegionStatus: setStatus } =
      await import("#/server/admin/admin-event.server");
    const outcome = await setStatus(data.regionId, data.status, request.user);
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "conflict")
      return { status: "conflict", reason: "region_not_retirable" };
    return {
      status: "ready",
      data: {
        outcome:
          data.status === "active" ? "region-reactivated" : "region-retired",
        regionId: data.regionId,
      },
    };
  });

export const grantAdminEventStaffEligibility = createServerFn({
  method: "POST",
})
  .validator(adminEventStaffEligibilityGrantSchema)
  .handler(async ({ data }): Promise<AdminEventMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { grantAdminEventStaffEligibility: grantEligibility } =
      await import("#/server/admin/admin-event.server");
    const outcome = await grantEligibility(data, request.user);
    if (!outcome) return { status: "not-found" };
    return {
      status: "ready",
      data: {
        outcome: "staff-eligibility-granted",
        eligibilityId: outcome.eligibilityId,
      },
    };
  });

export const revokeAdminEventStaffEligibility = createServerFn({
  method: "POST",
})
  .validator(adminEventStaffEligibilityParamsSchema)
  .handler(async ({ data }): Promise<AdminEventMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { revokeAdminEventStaffEligibility: revokeEligibility } =
      await import("#/server/admin/admin-event.server");
    const outcome = await revokeEligibility(data.eligibilityId, request.user);
    if (outcome === "not-found") return { status: "not-found" };
    return {
      status: "ready",
      data: {
        outcome: "staff-eligibility-revoked",
        eligibilityId: data.eligibilityId,
      },
    };
  });

export const searchAdminEventStaffCandidates = createServerFn({ method: "GET" })
  .validator(adminEventStaffCandidateSearchSchema)
  .handler(
    async ({
      data,
    }): Promise<AdminEventResult<Array<AdminEventPersonOption>>> => {
      const { getAdministratorRequest } =
        await import("#/server/admin/admin-access.server");
      const request = await getAdministratorRequest();
      if (request.status !== "ready") return request;
      const { findAdminEventStaffCandidates } =
        await import("#/server/admin/admin-event.server");
      return {
        status: "ready",
        data: await findAdminEventStaffCandidates(data),
      };
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

export const rescheduleAdminEventOccurrence = createServerFn({ method: "POST" })
  .validator(adminEventOccurrenceRescheduleFormSchema)
  .handler(async ({ data }): Promise<AdminEventMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const [
      { rescheduleAdminEventOccurrence: rescheduleOccurrence },
      { convertAdminEventOccurrenceForm },
    ] = await Promise.all([
      import("#/server/admin/admin-event.server"),
      import("#/server/admin/event-timezone.server"),
    ]);
    const occurrence = convertAdminEventOccurrenceForm(data.occurrence);
    if (!occurrence)
      return { status: "conflict", reason: "occurrence_not_publishable" };
    const outcome = await rescheduleOccurrence(
      data.eventOccurrenceId,
      {
        occurrence,
        registrationWindowPolicy: data.registrationWindowPolicy,
        regionsConfirmed: data.regionsConfirmed,
        regionalCoverage: data.regionalCoverage,
      },
      request.user,
    );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "slug-in-use")
      return { status: "conflict", reason: "slug_in_use" };
    if (outcome === "invalid-window-policy")
      return {
        status: "conflict",
        reason: "registration_window_policy_invalid",
      };
    if (outcome === "regions-not-confirmed")
      return { status: "conflict", reason: "regions_not_confirmed" };
    if (outcome === "conflict")
      return { status: "conflict", reason: "occurrence_not_publishable" };
    return {
      status: "ready",
      data: {
        outcome: "occurrence-rescheduled",
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
