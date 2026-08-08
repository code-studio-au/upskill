import "@tanstack/react-start/server-only";

export class AuthorizationError extends Error {
  readonly status = 403;

  constructor(message = "You are not authorized to perform this action") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export type OrganizationRole = "owner" | "admin" | "manager" | "learner";

const rank: Record<OrganizationRole, number> = {
  learner: 0,
  manager: 1,
  admin: 2,
  owner: 3,
};

export function requireOrganizationRole(
  actual: OrganizationRole | null,
  required: OrganizationRole,
): void {
  if (!actual || rank[actual] < rank[required]) throw new AuthorizationError();
}

export function assertResourceOrganization(
  resourceOrganizationId: string,
  requestedOrganizationId: string,
): void {
  if (resourceOrganizationId !== requestedOrganizationId)
    throw new AuthorizationError();
}
