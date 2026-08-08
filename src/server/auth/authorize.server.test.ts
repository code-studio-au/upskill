import { describe, expect, it } from "vitest";
import {
  assertResourceOrganization,
  AuthorizationError,
  requireOrganizationRole,
} from "./authorize.server";

describe("authorization primitives", () => {
  it("rejects a role below the required rank", () => {
    expect(() => requireOrganizationRole("learner", "manager")).toThrow(
      AuthorizationError,
    );
  });

  it("accepts a stronger role", () => {
    expect(() => requireOrganizationRole("owner", "manager")).not.toThrow();
  });

  it("prevents cross-organization resource access", () => {
    expect(() => assertResourceOrganization("org-a", "org-b")).toThrow(
      AuthorizationError,
    );
  });
});
