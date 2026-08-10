import { createServerFn } from "@tanstack/react-start";
import type { AdminResourceLibraryResult } from "#/features/resource/resource.schema";

export const getAdminResources = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminResourceLibraryResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminResources } =
      await import("#/server/admin/admin-resource.server");
    return { status: "ready", data: await findAdminResources() };
  },
);
