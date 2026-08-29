import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { environment } = vi.hoisted(() => ({
  environment: {
    APP_ENV: "test",
    BETTER_AUTH_SECRET: "test-only-scorm-preview-secret-over-32-characters",
  },
}));

vi.mock("#/server/env.server", () => ({
  getServerEnv: () => environment,
}));

vi.mock("#/server/db/database.server", () => ({
  getDatabase: vi.fn(),
}));

import {
  issueScormPreviewToken,
  scormPreviewCookie,
  verifyScormPreviewToken,
} from "./scorm-preview.server";

describe("SCORM administrator preview tokens", () => {
  beforeEach(() => {
    environment.APP_ENV = "test";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T02:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("binds a short-lived signed token to one package version", () => {
    const token = issueScormPreviewToken("scorm_version_one");
    expect(verifyScormPreviewToken(token)?.packageVersionId).toBe(
      "scorm_version_one",
    );
    vi.advanceTimersByTime(10 * 60 * 1_000 + 1_000);
    expect(verifyScormPreviewToken(token)).toBeNull();
  });

  it("rejects tampering and stores the token in an HTTP-only scoped cookie", () => {
    const token = issueScormPreviewToken("scorm_version_one");
    const separator = token.indexOf(".");
    const tampered = `${token.slice(0, separator)}x${token.slice(separator)}`;
    expect(verifyScormPreviewToken(tampered)).toBeNull();
    expect(scormPreviewCookie(token)).toContain("HttpOnly");
    expect(scormPreviewCookie(token)).toContain("Path=/api/scorm/previews/");
    expect(scormPreviewCookie(token)).toContain("SameSite=Strict");
  });

  it("uses a secure prefix compatible with its scoped staging path", () => {
    environment.APP_ENV = "staging";
    const cookie = scormPreviewCookie(
      issueScormPreviewToken("scorm_version_one"),
    );
    expect(cookie).toMatch(/^__Secure-upskill_scorm_preview=/u);
    expect(cookie).toContain("Path=/api/scorm/previews/");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("__Host-");
  });
});
