import { createServerFn } from "@tanstack/react-start";
import {
  adminSurveyCreateSchema,
  adminSurveyDraftSchema,
  adminSurveyParamsSchema,
  adminSurveyVersionParamsSchema,
  type AdminSurveyDetailResult,
  type AdminSurveyMutationResult,
  type AdminSurveyResult,
  type AdminSurveySummary,
} from "#/features/survey/survey.schema";

export const getAdminSurveys = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminSurveyResult<Array<AdminSurveySummary>>> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminSurveys } =
      await import("#/server/admin/admin-survey.server");
    return { status: "ready", data: await findAdminSurveys() };
  },
);

export const getAdminSurvey = createServerFn({ method: "GET" })
  .validator(adminSurveyParamsSchema)
  .handler(async ({ data }): Promise<AdminSurveyDetailResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminSurvey } =
      await import("#/server/admin/admin-survey.server");
    const survey = await findAdminSurvey(data.surveyId);
    return survey ? { status: "ready", data: survey } : { status: "not-found" };
  });

export const createAdminSurvey = createServerFn({ method: "POST" })
  .validator(adminSurveyCreateSchema)
  .handler(async ({ data }): Promise<AdminSurveyMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { createAdminSurvey: createSurvey } =
      await import("#/server/admin/admin-survey.server");
    const created = await createSurvey(data.title, data.usage, request.user);
    return {
      status: "ready",
      data: { outcome: "created", ...created },
    };
  });

export const saveAdminSurvey = createServerFn({ method: "POST" })
  .validator(adminSurveyDraftSchema)
  .handler(async ({ data }): Promise<AdminSurveyMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { saveAdminSurveyDraft } =
      await import("#/server/admin/admin-survey.server");
    const result = await saveAdminSurveyDraft(data, request.user);
    if (result === "not-found") return { status: "not-found" };
    if (result === "published")
      return { status: "conflict", reason: "version_is_published" };
    return {
      status: "ready",
      data: { outcome: "saved", surveyId: data.surveyId },
    };
  });

export const createAdminSurveyVersion = createServerFn({ method: "POST" })
  .validator(adminSurveyParamsSchema)
  .handler(async ({ data }): Promise<AdminSurveyMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { createAdminSurveyVersion: createVersion } =
      await import("#/server/admin/admin-survey.server");
    const result = await createVersion(data.surveyId, request.user);
    if (result.status === "not-found") return { status: "not-found" };
    if (result.status !== "created")
      return { status: "conflict", reason: result.status };
    return {
      status: "ready",
      data: {
        outcome: "created",
        surveyId: data.surveyId,
        versionId: result.versionId,
      },
    };
  });

export const publishAdminSurvey = createServerFn({ method: "POST" })
  .validator(adminSurveyVersionParamsSchema)
  .handler(async ({ data }): Promise<AdminSurveyMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { publishAdminSurveyVersion } =
      await import("#/server/admin/admin-survey.server");
    const result = await publishAdminSurveyVersion(
      data.surveyId,
      data.versionId,
      request.user,
    );
    if (result === "not-found") return { status: "not-found" };
    if (result === "invalid")
      return { status: "conflict", reason: "draft_not_publishable" };
    return {
      status: "ready",
      data: { outcome: "published", surveyId: data.surveyId },
    };
  });
