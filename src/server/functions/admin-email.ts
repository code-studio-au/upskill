import { createServerFn } from "@tanstack/react-start";
import {
  adminEmailDesignCreateVersionSchema,
  adminEmailDesignCreateSchema,
  adminEmailDesignDetailParamsSchema,
  adminEmailDesignDraftSchema,
  adminEmailDesignMoveSchema,
  adminEmailDesignVersionParamsSchema,
  type AdminEmailDesignSummary,
  type AdminEmailDetailResult,
  type AdminEmailMutationResult,
  type AdminEmailPreviewResult,
  type AdminEmailResult,
} from "#/features/admin-email/admin-email.schema";

export const getAdminEmailDesigns = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminEmailResult<Array<AdminEmailDesignSummary>>> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminEmailDesigns } =
      await import("#/server/admin/admin-email.server");
    return { status: "ready", data: await findAdminEmailDesigns() };
  },
);

export const getAdminEmailDesign = createServerFn({ method: "GET" })
  .validator(adminEmailDesignDetailParamsSchema)
  .handler(async ({ data }): Promise<AdminEmailDetailResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminEmailDesign } =
      await import("#/server/admin/admin-email.server");
    const design = await findAdminEmailDesign(
      data.emailDesignId,
      data.versionId,
    );
    return design ? { status: "ready", data: design } : { status: "not-found" };
  });

export const createAdminOfferingEmail = createServerFn({ method: "POST" })
  .validator(adminEmailDesignCreateSchema)
  .handler(async ({ data }): Promise<AdminEmailMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { createAdminOfferingEmail: createEmail } =
      await import("#/server/admin/admin-email.server");
    const created = await createEmail(data, request.user);
    return {
      status: "ready",
      data: { outcome: "created", ...created },
    };
  });

export const moveAdminEmailDesign = createServerFn({ method: "POST" })
  .validator(adminEmailDesignMoveSchema)
  .handler(async ({ data }): Promise<AdminEmailMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { moveAdminEmailDesign: moveDesign } =
      await import("#/server/admin/admin-email.server");
    const outcome = await moveDesign(data, request.user);
    if (outcome === "not-found") return { status: "not-found" };
    return {
      status: "ready",
      data: { outcome: "moved", emailDesignId: data.emailDesignId },
    };
  });

export const createAdminEmailDraft = createServerFn({ method: "POST" })
  .validator(adminEmailDesignCreateVersionSchema)
  .handler(async ({ data }): Promise<AdminEmailMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { createAdminEmailDraft: createDraft } =
      await import("#/server/admin/admin-email.server");
    const result = await createDraft(
      data.emailDesignId,
      data.sourceVersionId,
      request.user,
    );
    if (result.status !== "created")
      return result.status === "not-found"
        ? { status: "not-found" }
        : { status: "conflict", reason: "draft_exists" };
    return {
      status: "ready",
      data: {
        outcome: "draft-created",
        emailDesignId: data.emailDesignId,
        versionId: result.versionId,
      },
    };
  });

export const saveAdminEmailDraft = createServerFn({ method: "POST" })
  .validator(adminEmailDesignDraftSchema)
  .handler(async ({ data }): Promise<AdminEmailMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { saveAdminEmailDraft: saveDraft } =
      await import("#/server/admin/admin-email.server");
    const outcome = await saveDraft(data);
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "published")
      return { status: "conflict", reason: "version_is_published" };
    if (outcome === "invalid")
      return { status: "conflict", reason: "invalid_template" };
    return {
      status: "ready",
      data: { outcome: "saved", emailDesignId: data.emailDesignId },
    };
  });

export const previewAdminEmail = createServerFn({ method: "POST" })
  .validator(adminEmailDesignDraftSchema)
  .handler(async ({ data }): Promise<AdminEmailPreviewResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { previewAdminEmail: previewEmail } =
      await import("#/server/admin/admin-email.server");
    const preview = await previewEmail(data);
    return preview
      ? { status: "ready", data: preview }
      : { status: "conflict", reason: "invalid_template" };
  });

export const publishAdminEmail = createServerFn({ method: "POST" })
  .validator(adminEmailDesignVersionParamsSchema)
  .handler(async ({ data }): Promise<AdminEmailMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { publishAdminEmailVersion } =
      await import("#/server/admin/admin-email.server");
    const outcome = await publishAdminEmailVersion(data, request.user);
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "invalid")
      return { status: "conflict", reason: "invalid_template" };
    return {
      status: "ready",
      data: { outcome: "published", emailDesignId: data.emailDesignId },
    };
  });

export const rollbackAdminEmail = createServerFn({ method: "POST" })
  .validator(adminEmailDesignVersionParamsSchema)
  .handler(async ({ data }): Promise<AdminEmailMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { rollbackAdminEmailVersion } =
      await import("#/server/admin/admin-email.server");
    const outcome = await rollbackAdminEmailVersion(data, request.user);
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "active")
      return { status: "conflict", reason: "active_version" };
    return {
      status: "ready",
      data: { outcome: "rolled-back", emailDesignId: data.emailDesignId },
    };
  });

export const deleteAdminEmailDraft = createServerFn({ method: "POST" })
  .validator(adminEmailDesignVersionParamsSchema)
  .handler(async ({ data }): Promise<AdminEmailMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { deleteAdminEmailDraft: deleteDraft } =
      await import("#/server/admin/admin-email.server");
    const outcome = await deleteDraft(data, request.user);
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "active")
      return { status: "conflict", reason: "active_version" };
    return {
      status: "ready",
      data: { outcome: "deleted", emailDesignId: data.emailDesignId },
    };
  });
