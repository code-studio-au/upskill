import { createServerFn } from "@tanstack/react-start";

export interface AppShellSession {
  user: {
    name: string;
    email: string;
    isPlatformAdministrator: boolean;
    hasAssignedEventOperations: boolean;
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
    ] = await Promise.all([
      import("#/server/admin/admin-access.server"),
      import("#/server/events/event-operations-access.server"),
      import("#/server/onboarding/learner-onboarding.server"),
    ]);
    const [administrator, eventOperations, onboarding] = await Promise.all([
      isPlatformAdministrator(user.id),
      hasAssignedEventOperations(user.id),
      findLearnerOnboarding(user),
    ]);
    return {
      user: {
        name: user.name,
        email: user.email,
        isPlatformAdministrator: administrator,
        hasAssignedEventOperations: eventOperations,
        requiresOnboarding: typeof onboarding !== "string",
      },
    };
  },
);
