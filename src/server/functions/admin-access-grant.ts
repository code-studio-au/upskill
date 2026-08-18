import { createServerFn } from "@tanstack/react-start";
import {
  adminAccessGrantCapacitySchema,
  adminAccessGrantCreateSchema,
  adminAccessGrantRevealSchema,
  adminAccessGrantRevokeSchema,
  type AdminAccessGrantDirectory,
  type AdminAccessGrantMutationResult,
  type AdminAccessGrantResult,
  type AdminAccessGrantRevealResult,
} from "#/features/admin-access/admin-access.schema";

export const getAdminAccessGrants = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminAccessGrantResult<AdminAccessGrantDirectory>> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminAccessGrants } =
      await import("#/server/admin/admin-access-grant.server");
    return { status: "ready", data: await findAdminAccessGrants() };
  },
);

export const createAdminAccessGrant = createServerFn({ method: "POST" })
  .validator(adminAccessGrantCreateSchema)
  .handler(async ({ data }): Promise<AdminAccessGrantMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { createAdminAccessGrant: createGrant } =
      await import("#/server/admin/admin-access-grant.server");
    const outcome = await createGrant(data, request.user);
    if (outcome.status !== "created") return outcome;
    return {
      status: "ready",
      data: {
        outcome: "created",
        accessGrantId: outcome.accessGrantId,
        ...(outcome.accessCode ? { accessCode: outcome.accessCode } : {}),
        generatedCodeCount: outcome.generatedCodeCount,
      },
    };
  });

export const revokeAdminAccessGrant = createServerFn({ method: "POST" })
  .validator(adminAccessGrantRevokeSchema)
  .handler(async ({ data }): Promise<AdminAccessGrantMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { revokeAdminAccessGrant: revokeGrant } =
      await import("#/server/admin/admin-access-grant.server");
    const outcome = await revokeGrant(data, request.user);
    if (outcome.status === "not-found") return outcome;
    return {
      status: "ready",
      data: {
        outcome: outcome.status,
        accessGrantId: outcome.accessGrantId,
      },
    };
  });

export const revealAdminAccessGrantCode = createServerFn({ method: "POST" })
  .validator(adminAccessGrantRevealSchema)
  .handler(async ({ data }): Promise<AdminAccessGrantRevealResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { revealAdminAccessGrantCode: revealCode } =
      await import("#/server/admin/admin-access-grant.server");
    const outcome = await revealCode(data, request.user);
    if (outcome.status !== "ready") return outcome;
    return {
      status: "ready",
      data: {
        accessGrantId: outcome.accessGrantId,
        accessCode: outcome.accessCode,
      },
    };
  });

export const updateAdminAccessGrantCapacity = createServerFn({ method: "POST" })
  .validator(adminAccessGrantCapacitySchema)
  .handler(async ({ data }): Promise<AdminAccessGrantMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { updateAdminAccessGrantCapacity: updateCapacity } =
      await import("#/server/admin/admin-access-grant.server");
    const outcome = await updateCapacity(data, request.user);
    if (outcome.status === "not-found" || outcome.status === "conflict")
      return outcome;
    return {
      status: "ready",
      data: {
        outcome: outcome.status,
        accessGrantId: outcome.accessGrantId,
      },
    };
  });
