import "@tanstack/react-start/server-only";

import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "./auth.server";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
}

export async function getRequestUser(): Promise<AuthenticatedUser | null> {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  if (!session) return null;

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email.toLocaleLowerCase("en-AU"),
  };
}
