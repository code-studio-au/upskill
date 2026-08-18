import { createServerFn } from "@tanstack/react-start";

export interface AppShellSession {
  user: {
    name: string;
    email: string;
    isPlatformAdministrator: boolean;
    hasAssignedEventOperations: boolean;
    hasAccessOwnerAssignments: boolean;
    requiresOnboarding: boolean;
  } | null;
}

export const getAppShellSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<AppShellSession> => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { user: null };
    const [
      { isPlatformAdministrator },
      { hasAssignedEventOperations },
      { findLearnerOnboarding },
      { hasAccessOwnerAssignments },
    ] = await Promise.all([
      import("#/server/admin/admin-access.server"),
      import("#/server/events/event-operations-access.server"),
      import("#/server/onboarding/learner-onboarding.server"),
      import("#/server/access/access-owner.server"),
    ]);
    const [administrator, eventOperations, onboarding, accessOwner] =
      await Promise.all([
        isPlatformAdministrator(user.id),
        hasAssignedEventOperations(user.id),
        findLearnerOnboarding(user),
        hasAccessOwnerAssignments(user.id),
      ]);
    return {
      user: {
        name: user.name,
        email: user.email,
        isPlatformAdministrator: administrator,
        hasAssignedEventOperations: eventOperations,
        hasAccessOwnerAssignments: accessOwner,
        requiresOnboarding: typeof onboarding !== "string",
      },
    };
  },
);
