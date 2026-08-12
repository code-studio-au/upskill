import { createServerFn } from "@tanstack/react-start";

export interface AppShellSession {
  user: {
    name: string;
    email: string;
    isPlatformAdministrator: boolean;
  } | null;
}

export const getAppShellSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<AppShellSession> => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { user: null };
    const { isPlatformAdministrator } =
      await import("#/server/admin/admin-access.server");
    return {
      user: {
        name: user.name,
        email: user.email,
        isPlatformAdministrator: await isPlatformAdministrator(user.id),
      },
    };
  },
);
