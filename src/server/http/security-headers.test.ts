import { describe, expect, it } from "vitest";
import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
} from "./security-headers";

describe("content security policy", () => {
  it("nonces script and style elements without permitting inline script attributes", () => {
    const policy = buildContentSecurityPolicy(
      "request-nonce",
      "https://learn.example.test",
    );
    expect(policy).toContain(
      "script-src 'self' 'nonce-request-nonce' 'strict-dynamic'",
    );
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("style-src-elem 'self' 'nonce-request-nonce'");
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
    expect(policy).not.toMatch(/script-src [^;]*unsafe-inline/);
  });

  it("applies the baseline response hardening headers", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "nonce");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("permissions-policy")).toContain("camera=()");
  });
});
