import { createServerFn } from "@tanstack/react-start";
import {
  accessOwnerGrantInputSchema,
  type AccessOwnerDashboard,
  type AccessOwnerResult,
} from "#/features/access-owner/access-owner.schema";

export const getAccessOwnerDashboard = createServerFn({
  method: "GET",
}).handler(async (): Promise<AccessOwnerResult<AccessOwnerDashboard>> => {
  const { getRequestUser } = await import("#/server/auth/session.server");
  const user = await getRequestUser();
  if (!user) return { status: "unauthenticated" };
  const { findAccessOwnerDashboard } =
    await import("#/server/access/access-owner.server");
  const data = await findAccessOwnerDashboard(user);
  return data ? { status: "ready", data } : { status: "forbidden" };
});

export const revealAccessOwnerGrantCode = createServerFn({ method: "POST" })
  .validator(accessOwnerGrantInputSchema)
  .handler(
    async ({ data }): Promise<AccessOwnerResult<{ accessCode: string }>> => {
      const { getRequestUser } = await import("#/server/auth/session.server");
      const user = await getRequestUser();
      if (!user) return { status: "unauthenticated" };
      const { revealAccessOwnerCode } =
        await import("#/server/access/access-owner.server");
      const result = await revealAccessOwnerCode(data.accessGrantId, user);
      return result.status === "ready"
        ? { status: "ready", data: { accessCode: result.accessCode } }
        : result;
    },
  );
