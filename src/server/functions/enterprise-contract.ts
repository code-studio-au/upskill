import { createServerFn } from "@tanstack/react-start";
import { courseSlugSchema } from "#/features/catalog/catalog.schema";
import type {
  EnterpriseCourseAccessResult,
  EnterpriseCourseEnrollmentResult,
  EnterpriseEventAccessResult,
  EnterpriseEventRegistrationResult,
} from "#/features/enterprise/enterprise-contract.schema";

export const getEnterpriseCourseAccess = createServerFn({ method: "GET" })
  .validator(courseSlugSchema)
  .handler(async ({ data }): Promise<EnterpriseCourseAccessResult> => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" };
    const { findEnterpriseCourseAccess } =
      await import("#/server/enterprise/enterprise-contract-access.server");
    return await findEnterpriseCourseAccess(data.slug, user);
  });

export const activateEnterpriseCourseAccess = createServerFn({ method: "POST" })
  .validator(courseSlugSchema)
  .handler(async ({ data }): Promise<EnterpriseCourseEnrollmentResult> => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" };
    const { enrollWithEnterpriseContract } =
      await import("#/server/enterprise/enterprise-contract-access.server");
    return await enrollWithEnterpriseContract(data.slug, user);
  });

export const getEnterpriseEventAccess = createServerFn({ method: "GET" })
  .validator(courseSlugSchema)
  .handler(async ({ data }): Promise<EnterpriseEventAccessResult> => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" };
    const { findEnterpriseEventAccess } =
      await import("#/server/enterprise/enterprise-contract-access.server");
    return await findEnterpriseEventAccess(data.slug, user);
  });

export const activateEnterpriseEventAccess = createServerFn({ method: "POST" })
  .validator(courseSlugSchema)
  .handler(async ({ data }): Promise<EnterpriseEventRegistrationResult> => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" };
    const { registerWithEnterpriseContract } =
      await import("#/server/enterprise/enterprise-contract-access.server");
    return await registerWithEnterpriseContract(data.slug, user);
  });
