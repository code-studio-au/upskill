import { createServerFn } from "@tanstack/react-start";
import {
  adminEnterpriseContractCreateSchema,
  adminEnterpriseContractBulkEnrollSchema,
  adminEnterpriseContractEligibilitySchema,
  adminEnterpriseContractLifecycleSchema,
  adminEnterpriseContractOwnerRevokeSchema,
  adminEnterpriseContractOwnerSchema,
  adminEnterpriseContractRevealSchema,
  adminEnterpriseContractRenewSchema,
  adminEnterpriseContractRotateCodeSchema,
  type AdminEnterpriseContractDirectory,
  type AdminEnterpriseContractMutationResult,
  type AdminEnterpriseContractResult,
  type AdminEnterpriseContractRevealResult,
} from "#/features/admin-contract/admin-contract.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";

export const getAdminEnterpriseContracts = createServerFn({
  method: "GET",
}).handler(
  async (): Promise<
    AdminEnterpriseContractResult<AdminEnterpriseContractDirectory>
  > => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminEnterpriseContracts } =
      await import("#/server/admin/admin-enterprise-contract.server");
    return { status: "ready", data: await findAdminEnterpriseContracts() };
  },
);

export const createAdminEnterpriseContract = createServerFn({ method: "POST" })
  .validator(adminEnterpriseContractCreateSchema)
  .handler(async ({ data }): Promise<AdminEnterpriseContractMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { createAdminEnterpriseContract: createContract } =
      await import("#/server/admin/admin-enterprise-contract.server");
    const outcome = await createContract(data, request.user);
    if (outcome.status !== "created") return outcome;
    return {
      status: "ready",
      data: {
        outcome: "created",
        enterpriseContractId: outcome.enterpriseContractId,
        accessCode: outcome.accessCode,
      },
    };
  });

export const transitionAdminEnterpriseContract = createServerFn({
  method: "POST",
})
  .validator(adminEnterpriseContractLifecycleSchema)
  .handler(async ({ data }): Promise<AdminEnterpriseContractMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { transitionAdminEnterpriseContract: transitionContract } =
      await import("#/server/admin/admin-enterprise-contract.server");
    const outcome = await transitionContract(data, request.user);
    if (outcome.status === "not-found" || outcome.status === "conflict")
      return outcome;
    return {
      status: "ready",
      data: {
        outcome: outcome.status,
        enterpriseContractId: outcome.enterpriseContractId,
      },
    };
  });

export const revealAdminEnterpriseContractCode = createServerFn({
  method: "POST",
})
  .validator(adminEnterpriseContractRevealSchema)
  .handler(async ({ data }): Promise<AdminEnterpriseContractRevealResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { revealAdminEnterpriseContractCode: revealCode } =
      await import("#/server/admin/admin-enterprise-contract.server");
    const outcome = await revealCode(data.enterpriseContractId, request.user);
    if (outcome.status === "not-found") return outcome;
    return {
      status: "ready",
      data: {
        enterpriseContractId: outcome.enterpriseContractId,
        accessCode: outcome.accessCode,
      },
    };
  });

async function administratorMutation<T>(
  callback: (user: AuthenticatedUser) => Promise<T>,
): Promise<T | { status: "unauthenticated" } | { status: "forbidden" }> {
  const { getAdministratorRequest } =
    await import("#/server/admin/admin-access.server");
  const request = await getAdministratorRequest();
  if (request.status !== "ready") return request;
  return await callback(request.user);
}

function readyMutation(outcome: {
  status: string;
  enterpriseContractId?: string;
  accessCode?: string;
  importedCount?: number;
  enrolledCount?: number;
  skippedCount?: number;
  eventRegisteredCount?: number;
  eventSkippedCount?: number;
}) {
  if (outcome.status === "not-found" || outcome.status === "conflict")
    return outcome;
  return {
    status: "ready" as const,
    data: {
      outcome: outcome.status,
      enterpriseContractId: outcome.enterpriseContractId ?? "",
      ...(outcome.accessCode ? { accessCode: outcome.accessCode } : {}),
      ...(outcome.importedCount === undefined
        ? {}
        : { importedCount: outcome.importedCount }),
      ...(outcome.enrolledCount === undefined
        ? {}
        : { enrolledCount: outcome.enrolledCount }),
      ...(outcome.skippedCount === undefined
        ? {}
        : { skippedCount: outcome.skippedCount }),
      ...(outcome.eventRegisteredCount === undefined
        ? {}
        : { eventRegisteredCount: outcome.eventRegisteredCount }),
      ...(outcome.eventSkippedCount === undefined
        ? {}
        : { eventSkippedCount: outcome.eventSkippedCount }),
    },
  };
}

export const rotateAdminEnterpriseContractCode = createServerFn({
  method: "POST",
})
  .validator(adminEnterpriseContractRotateCodeSchema)
  .handler(
    async ({ data }): Promise<AdminEnterpriseContractMutationResult> =>
      await administratorMutation(async (user) => {
        const { rotateAdminEnterpriseContractCode: rotate } =
          await import("#/server/admin/admin-enterprise-contract.server");
        return readyMutation(
          await rotate(data, user),
        ) as AdminEnterpriseContractMutationResult;
      }),
  );

export const renewAdminEnterpriseContract = createServerFn({ method: "POST" })
  .validator(adminEnterpriseContractRenewSchema)
  .handler(
    async ({ data }): Promise<AdminEnterpriseContractMutationResult> =>
      await administratorMutation(async (user) => {
        const { renewAdminEnterpriseContract: renew } =
          await import("#/server/admin/admin-enterprise-contract.server");
        return readyMutation(
          await renew(data, user),
        ) as AdminEnterpriseContractMutationResult;
      }),
  );

export const replaceAdminEnterpriseContractEligibility = createServerFn({
  method: "POST",
})
  .validator(adminEnterpriseContractEligibilitySchema)
  .handler(
    async ({ data }): Promise<AdminEnterpriseContractMutationResult> =>
      await administratorMutation(async (user) => {
        const { replaceAdminEnterpriseContractEligibility: replace } =
          await import("#/server/admin/admin-enterprise-contract.server");
        return readyMutation(
          await replace(data, user),
        ) as AdminEnterpriseContractMutationResult;
      }),
  );

export const assignAdminEnterpriseContractOwners = createServerFn({
  method: "POST",
})
  .validator(adminEnterpriseContractOwnerSchema)
  .handler(
    async ({ data }): Promise<AdminEnterpriseContractMutationResult> =>
      await administratorMutation(async (user) => {
        const { assignAdminEnterpriseContractOwners: assign } =
          await import("#/server/admin/admin-enterprise-contract.server");
        return readyMutation(
          await assign(data, user),
        ) as AdminEnterpriseContractMutationResult;
      }),
  );

export const revokeAdminEnterpriseContractOwner = createServerFn({
  method: "POST",
})
  .validator(adminEnterpriseContractOwnerRevokeSchema)
  .handler(
    async ({ data }): Promise<AdminEnterpriseContractMutationResult> =>
      await administratorMutation(async (user) => {
        const { revokeAdminEnterpriseContractOwner: revoke } =
          await import("#/server/admin/admin-enterprise-contract.server");
        return readyMutation(
          await revoke(data, user),
        ) as AdminEnterpriseContractMutationResult;
      }),
  );

export const bulkEnrollAdminEnterpriseContract = createServerFn({
  method: "POST",
})
  .validator(adminEnterpriseContractBulkEnrollSchema)
  .handler(
    async ({ data }): Promise<AdminEnterpriseContractMutationResult> =>
      await administratorMutation(async (user) => {
        const { bulkEnrollAdminEnterpriseContract: bulkEnroll } =
          await import("#/server/admin/admin-enterprise-contract.server");
        return readyMutation(
          await bulkEnroll(data, user),
        ) as AdminEnterpriseContractMutationResult;
      }),
  );
