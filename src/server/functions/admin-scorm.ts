import { createServerFn } from "@tanstack/react-start";
import type { AdminScormLibraryResult } from "#/features/scorm/scorm-package.schema";

export const getAdminScormPackages = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminScormLibraryResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminScormPackages } =
      await import("#/server/admin/admin-scorm.server");
    return { status: "ready", data: await findAdminScormPackages() };
  },
);
