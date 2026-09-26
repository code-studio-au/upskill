import "@tanstack/react-start/server-only";

import { getDatabase } from "#/server/db/database.server";
import { lockActiveOfflineScormSession } from "#/server/scorm/offline-scorm-auth-lifecycle.server";
import { queryRetainedOfflineScormServerState } from "#/server/scorm/offline-scorm-inventory.server";

interface SignOutSession {
  sessionId: string;
  userId: string;
}

type SignOutPreparation = "blocked" | "ready" | "stale";

interface SignOutGateDependencies {
  getSession(request: Request): Promise<SignOutSession | undefined>;
  prepareSignOut(session: SignOutSession): Promise<SignOutPreparation>;
}

const defaultDependencies: SignOutGateDependencies = {
  async getSession(request) {
    const { getRequestAuthentication } =
      await import("#/server/auth/session.server");
    const authentication = await getRequestAuthentication(request.headers);
    return authentication
      ? {
          sessionId: authentication.sessionId,
          userId: authentication.user.id,
        }
      : undefined;
  },
  async prepareSignOut(session) {
    return await getDatabase()
      .transaction()
      .execute(async (transaction) => {
        const now = new Date();
        if (
          !(await lockActiveOfflineScormSession(transaction, {
            ...session,
            now,
          }))
        )
          return "stale";
        if (
          await queryRetainedOfflineScormServerState(
            transaction,
            session.userId,
          )
        )
          return "blocked";
        // Better Auth deletes this row and clears its cookie after the gate.
        // Expiring it under the shared lifecycle lock is the durable marker
        // that makes an already-authenticated activation fail after we commit.
        const update = await transaction
          .updateTable("session")
          .set({ expiresAt: now, updatedAt: now })
          .where("id", "=", session.sessionId)
          .where("userId", "=", session.userId)
          .where("expiresAt", ">", now)
          .executeTakeFirst();
        if (update.numUpdatedRows !== 1n)
          throw new Error(
            "Offline SCORM sign-out session changed while locked",
          );
        return "ready";
      });
  },
};

export async function offlineScormSignOutGate(
  request: Request,
  dependencies: SignOutGateDependencies = defaultDependencies,
): Promise<Response | undefined> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api/auth/sign-out" && pathname !== "/api/auth/sign-out/")
    return undefined;
  const session = await dependencies.getSession(request);
  if (session === undefined) return undefined;
  const preparation = await dependencies.prepareSignOut(session);
  if (preparation !== "blocked") return undefined;
  return Response.json(
    { error: "offline_cleanup_required" },
    { status: 409, headers: { "Cache-Control": "no-store" } },
  );
}
