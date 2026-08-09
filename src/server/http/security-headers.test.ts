import { describe, expect, it, vi } from "vitest";
import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
  buildLearningContentSecurityPolicy,
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
    expect(headers.has("strict-transport-security")).toBe(false);
  });

  it("adds HSTS only in HTTPS deployment environments", () => {
    vi.stubEnv("APP_ENV", "production");
    const headers = new Headers();
    applySecurityHeaders(headers, "nonce");
    expect(headers.get("strict-transport-security")).toContain(
      "includeSubDomains",
    );
    vi.unstubAllEnvs();
  });

  it("allows only the application origin to frame learning responses", () => {
    const policy = buildLearningContentSecurityPolicy(
      "learning-nonce",
      "https://app.example.test",
    );
    expect(policy).toContain("frame-ancestors https://app.example.test");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).not.toContain("unsafe-inline");

    vi.stubEnv("APP_ORIGIN", "https://app.example.test");
    vi.stubEnv("LEARNING_ORIGIN", "https://learn.example.test");
    const headers = new Headers();
    applySecurityHeaders(
      headers,
      "learning-nonce",
      new Request("https://learn.example.test/api/scorm/attempts/attempt_1"),
    );
    expect(headers.has("x-frame-options")).toBe(false);
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("content-security-policy")).toContain(
      "frame-ancestors https://app.example.test",
    );
    vi.unstubAllEnvs();
  });
});
