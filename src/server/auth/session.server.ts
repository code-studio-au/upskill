import "@tanstack/react-start/server-only";

import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "./auth.server";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

export interface RequestAuthentication {
  sessionId: string;
  user: AuthenticatedUser;
}

export async function getRequestAuthentication(
  headers: Headers = getRequestHeaders(),
): Promise<RequestAuthentication | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;

  return {
    sessionId: session.session.id,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email.toLocaleLowerCase("en-AU"),
      emailVerified: session.user.emailVerified,
    },
  };
}

export async function getRequestUser(): Promise<AuthenticatedUser | null> {
  return (await getRequestAuthentication())?.user ?? null;
}
