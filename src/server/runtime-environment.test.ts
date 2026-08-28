import { describe, expect, it } from "vitest";
import { parseServerEnvironment } from "./runtime-environment";

const baseEnvironment = {
  DATABASE_URL: "postgresql://upskill:upskill@localhost:5433/upskill",
  BETTER_AUTH_SECRET: "local-only-secret-with-more-than-32-characters",
  STRIPE_SECRET_KEY: "sk_test_local",
  STRIPE_WEBHOOK_SECRET: "whsec_local",
};

describe("server runtime environment", () => {
  it("applies local endpoints and provider defaults", () => {
    const environment = parseServerEnvironment(baseEnvironment);
    expect(environment.APP_ENV).toBe("development");
    expect(environment.SQS_ENDPOINT).toBe("http://127.0.0.1:9324");
    expect(environment.EMAIL_PROVIDER).toBe("local_capture");
    expect(environment.SMS_PROVIDER).toBe("local_capture");
  });

  it("requires all selected provider credentials", () => {
    expect(() =>
      parseServerEnvironment({ ...baseEnvironment, EMAIL_PROVIDER: "mailgun" }),
    ).toThrow("MAILGUN_API_KEY");
    expect(() =>
      parseServerEnvironment({
        ...baseEnvironment,
        SMS_PROVIDER: "textbee",
        TEXTBEE_API_KEY: "api-key",
      }),
    ).toThrow("TEXTBEE_WEBHOOK_SECRET");
  });

  it("rejects non-canonical and placeholder staging origins", () => {
    expect(() =>
      parseServerEnvironment({
        ...baseEnvironment,
        APP_ENV: "staging",
        APP_ORIGIN: "http://staging.upskill.institute",
        LEARNING_ORIGIN: "https://learn-staging.upskill.institute",
      }),
    ).toThrow("APP_ORIGIN must use HTTPS");
    expect(() =>
      parseServerEnvironment({
        ...baseEnvironment,
        APP_ENV: "production",
        APP_ORIGIN: "https://upskill.example",
        LEARNING_ORIGIN: "https://learn.upskill.example",
      }),
    ).toThrow("APP_ORIGIN must be configured");
  });
});
