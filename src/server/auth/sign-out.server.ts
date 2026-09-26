import "@tanstack/react-start/server-only";

import { hasRetainedOfflineScormServerState } from "#/server/scorm/offline-scorm-inventory.server";

interface SignOutGateDependencies {
  getUserId(request: Request): Promise<string | undefined>;
  hasRetainedOfflineState(userId: string): Promise<boolean>;
}

const defaultDependencies: SignOutGateDependencies = {
  async getUserId(request) {
    const { auth } = await import("#/server/auth/auth.server");
    const session = await auth.api.getSession({ headers: request.headers });
    return session?.user.id;
  },
  hasRetainedOfflineState: hasRetainedOfflineScormServerState,
};

export async function offlineScormSignOutGate(
  request: Request,
  dependencies: SignOutGateDependencies = defaultDependencies,
): Promise<Response | undefined> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api/auth/sign-out" && pathname !== "/api/auth/sign-out/")
    return undefined;
  const userId = await dependencies.getUserId(request);
  if (
    userId === undefined ||
    !(await dependencies.hasRetainedOfflineState(userId))
  )
    return undefined;
  return Response.json(
    { error: "offline_cleanup_required" },
    { status: 409, headers: { "Cache-Control": "no-store" } },
  );
}
