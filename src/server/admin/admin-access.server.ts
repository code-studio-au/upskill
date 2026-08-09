import "@tanstack/react-start/server-only";

import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getRequestUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";

export type AdministratorRequest =
  | { status: "ready"; user: AuthenticatedUser }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export async function isPlatformAdministrator(
  userId: string,
): Promise<boolean> {
  const assignment = await getDatabase()
    .selectFrom("platform_admin")
    .select("userId")
    .where("userId", "=", userId)
    .executeTakeFirst();
  return Boolean(assignment);
}

export async function getAdministratorRequest(): Promise<AdministratorRequest> {
  const user = await getRequestUser();
  if (!user) return { status: "unauthenticated" };
  if (!(await isPlatformAdministrator(user.id))) return { status: "forbidden" };
  return { status: "ready", user };
}
