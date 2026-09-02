import { createServerFn } from "@tanstack/react-start";
import {
  registrationQuestionnaireAdminTargetSchema,
  registrationQuestionnaireWaiverSchema,
  type RegistrationQuestionnaireAdminResult,
  type RegistrationQuestionnaireWaiverResult,
} from "#/features/registration/admin-registration-questionnaire.schema";

export const getAdminRegistrationQuestionnaire = createServerFn({
  method: "GET",
})
  .validator(registrationQuestionnaireAdminTargetSchema)
  .handler(async ({ data }): Promise<RegistrationQuestionnaireAdminResult> => {
    const registration =
      await import("#/server/registration/admin-registration-questionnaire.server");
    if (data.kind === "course") {
      const { getAdministratorRequest } =
        await import("#/server/admin/admin-access.server");
      const request = await getAdministratorRequest();
      if (request.status !== "ready") return request;
      const detail =
        await registration.findCourseRegistrationQuestionnaireAdminDetail(
          data.courseId,
          data.enrollmentId,
        );
      return detail
        ? { status: "ready", data: detail }
        : { status: "not-found" };
    }
    const { canAdministerEvent, getEventOperationsRequest } =
      await import("#/server/events/event-operations-access.server");
    const request = await getEventOperationsRequest(data.eventOccurrenceId);
    if (request.status !== "ready") return request;
    if (!canAdministerEvent(request.access)) return { status: "forbidden" };
    const detail =
      await registration.findEventRegistrationQuestionnaireAdminDetail(
        data.eventOccurrenceId,
        data.registrationId,
      );
    return detail ? { status: "ready", data: detail } : { status: "not-found" };
  });

export const waiveAdminRegistrationQuestionnaire = createServerFn({
  method: "POST",
})
  .validator(registrationQuestionnaireWaiverSchema)
  .handler(async ({ data }): Promise<RegistrationQuestionnaireWaiverResult> => {
    const registration =
      await import("#/server/registration/admin-registration-questionnaire.server");
    if (data.target.kind === "course") {
      const { getAdministratorRequest } =
        await import("#/server/admin/admin-access.server");
      const request = await getAdministratorRequest();
      if (request.status !== "ready") return request;
      const outcome = await registration.waiveCourseRegistrationQuestionnaire(
        data.target.courseId,
        data.target.enrollmentId,
        data.reason,
        request.user,
      );
      return outcome === "waived" ? { status: "ready" } : { status: outcome };
    }
    const { canAdministerEvent, getEventOperationsRequest } =
      await import("#/server/events/event-operations-access.server");
    const request = await getEventOperationsRequest(
      data.target.eventOccurrenceId,
    );
    if (request.status !== "ready") return request;
    if (!canAdministerEvent(request.access)) return { status: "forbidden" };
    const outcome = await registration.waiveEventRegistrationQuestionnaire(
      data.target.eventOccurrenceId,
      data.target.registrationId,
      data.reason,
      request.access.user,
    );
    return outcome === "waived" ? { status: "ready" } : { status: outcome };
  });
