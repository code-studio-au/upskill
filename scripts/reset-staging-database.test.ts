import { describe, expect, it } from "vitest";
import {
  STAGING_RESET_CONFIRMATION,
  validateStagingResetEnvironment,
} from "./reset-staging-database.ts";

function stagingEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    ALLOW_STAGING_RESET: STAGING_RESET_CONFIRMATION,
    APP_ENV: "staging",
    APP_ORIGIN: "https://staging.upskill.institute",
    DATABASE_URL: "postgresql://web:secret@database.example:5432/upskill",
    MIGRATION_DATABASE_URL:
      "postgresql://owner:secret@database.example:5432/upskill",
    STAGING_RESET_DATABASE_TARGET: "database.example:5432/upskill",
    WORKER_DATABASE_URL:
      "postgresql://worker:secret@database.example:5432/upskill",
    ...overrides,
  };
}

describe("guarded staging database reset", () => {
  it("accepts one explicitly confirmed staging database", () => {
    expect(validateStagingResetEnvironment(stagingEnvironment())).toMatchObject(
      {
        databaseTarget: "database.example:5432/upskill",
      },
    );
  });

  it.each([
    ["APP_ENV", "production"],
    ["ALLOW_STAGING_RESET", "yes"],
    ["APP_ORIGIN", "https://upskill.institute"],
    ["APP_ORIGIN", "https://staging.example.com"],
    ["STAGING_RESET_DATABASE_TARGET", "other.example:5432/upskill"],
    ["DATABASE_URL", "postgresql://web:secret@other.example:5432/upskill"],
    ["MIGRATION_DATABASE_URL", "postgresql://owner:secret@localhost/upskill"],
  ])("rejects an unsafe %s value", (key, value) => {
    expect(() =>
      validateStagingResetEnvironment(stagingEnvironment({ [key]: value })),
    ).toThrow();
  });
});
