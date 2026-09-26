import { describe, expect, it } from "vitest";
import { parseServerEnvironment } from "./runtime-environment";

const baseEnvironment = {
  DATABASE_URL: "postgresql://upskill:upskill@localhost:5433/upskill",
  BETTER_AUTH_SECRET: "local-only-secret-with-more-than-32-characters",
  STRIPE_SECRET_KEY: "sk_test_local",
  STRIPE_WEBHOOK_SECRET: "whsec_local",
};
const offlineScormOriginKey = Buffer.alloc(32, 7).toString("base64url");

describe("server runtime environment", () => {
  it("applies local endpoints and provider defaults", () => {
    const environment = parseServerEnvironment(baseEnvironment);
    expect(environment.APP_ENV).toBe("development");
    expect(environment.SQS_ENDPOINT).toBe("http://127.0.0.1:9324");
    expect(environment.EMAIL_PROVIDER).toBe("local_capture");
    expect(environment.SMS_PROVIDER).toBe("local_capture");
    expect(environment.LIVEKIT_ENABLED).toBe(false);
    expect(environment.OFFLINE_SCORM_ENABLED).toBe(false);
  });

  it("derives a stable local-only encryption key without a committed key", () => {
    const first = parseServerEnvironment(baseEnvironment);
    const repeated = parseServerEnvironment(baseEnvironment);
    const withAnotherAuthenticationSecret = parseServerEnvironment({
      ...baseEnvironment,
      BETTER_AUTH_SECRET: "another-local-secret-with-more-than-32-characters",
    });

    expect(first.ACCESS_CODE_ENCRYPTION_KEY).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(repeated.ACCESS_CODE_ENCRYPTION_KEY).toBe(
      first.ACCESS_CODE_ENCRYPTION_KEY,
    );
    expect(withAnotherAuthenticationSecret.ACCESS_CODE_ENCRYPTION_KEY).not.toBe(
      first.ACCESS_CODE_ENCRYPTION_KEY,
    );
  });

  it("requires an independently configured encryption key outside local environments", () => {
    const localEncryptionKey =
      parseServerEnvironment(baseEnvironment).ACCESS_CODE_ENCRYPTION_KEY;
    const deployedEnvironment = {
      ...baseEnvironment,
      APP_ENV: "staging",
      APP_ORIGIN: "https://staging.codestudio.au",
      LEARNING_ORIGIN: "https://learn-staging.codestudio.au",
    };

    expect(() => parseServerEnvironment(deployedEnvironment)).toThrow(
      "A non-local ACCESS_CODE_ENCRYPTION_KEY is required outside local environments",
    );
    expect(() =>
      parseServerEnvironment({
        ...deployedEnvironment,
        ACCESS_CODE_ENCRYPTION_KEY: localEncryptionKey,
      }),
    ).toThrow(
      "A non-local ACCESS_CODE_ENCRYPTION_KEY is required outside local environments",
    );
  });

  it("requires complete offline SCORM signing and package-site authorities", () => {
    expect(() =>
      parseServerEnvironment({
        ...baseEnvironment,
        OFFLINE_SCORM_ENABLED: "true",
      }),
    ).toThrow("OFFLINE_SCORM_ENTITLEMENT_SIGNING_KEY_ID");
    expect(() =>
      parseServerEnvironment({
        ...baseEnvironment,
        OFFLINE_SCORM_ENABLED: "true",
        OFFLINE_SCORM_ENTITLEMENT_SIGNING_KEY_ID: "development-key-1",
      }),
    ).toThrow("OFFLINE_SCORM_ENTITLEMENT_SIGNING_PRIVATE_KEY_PKCS8");
    expect(() =>
      parseServerEnvironment({
        ...baseEnvironment,
        OFFLINE_SCORM_ENABLED: "true",
        OFFLINE_SCORM_ENTITLEMENT_SIGNING_KEY_ID: "development-key-1",
        OFFLINE_SCORM_ENTITLEMENT_SIGNING_PRIVATE_KEY_PKCS8: "A".repeat(100),
      }),
    ).toThrow("OFFLINE_SCORM_PACKAGE_SITE_SUFFIX");
    expect(() =>
      parseServerEnvironment({
        ...baseEnvironment,
        OFFLINE_SCORM_ENABLED: "true",
        OFFLINE_SCORM_ENTITLEMENT_SIGNING_KEY_ID: "development-key-1",
        OFFLINE_SCORM_ENTITLEMENT_SIGNING_PRIVATE_KEY_PKCS8: "A".repeat(100),
        OFFLINE_SCORM_PACKAGE_SITE_SUFFIX: "github.io",
      }),
    ).toThrow("OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY");
    expect(() =>
      parseServerEnvironment({
        ...baseEnvironment,
        OFFLINE_SCORM_ENABLED: "true",
        OFFLINE_SCORM_ENTITLEMENT_SIGNING_KEY_ID: "development-key-1",
        OFFLINE_SCORM_ENTITLEMENT_SIGNING_PRIVATE_KEY_PKCS8: "A".repeat(100),
        OFFLINE_SCORM_PACKAGE_SITE_SUFFIX: "github.io",
        OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY: offlineScormOriginKey,
      }),
    ).not.toThrow();
  });

  it("requires a complete, environment-bound LiveKit configuration before enablement", () => {
    expect(() =>
      parseServerEnvironment({ ...baseEnvironment, LIVEKIT_ENABLED: "true" }),
    ).toThrow("LIVEKIT_PROJECT_ENVIRONMENT");
    expect(() =>
      parseServerEnvironment({
        ...baseEnvironment,
        LIVEKIT_ENABLED: "true",
        LIVEKIT_PROJECT_ENVIRONMENT: "production",
      }),
    ).toThrow("must match APP_ENV");
    expect(() =>
      parseServerEnvironment({
        ...baseEnvironment,
        LIVEKIT_ENABLED: "true",
        LIVEKIT_PROJECT_ENVIRONMENT: "development",
        LIVEKIT_URL: "ws://127.0.0.1:7880",
        LIVEKIT_API_KEY: "development-key",
        LIVEKIT_API_SECRET: "development-secret-with-32-characters",
        LIVEKIT_APPROVED_MAX_PARTICIPANTS: "10",
        LIVEKIT_APPROVED_MAX_CONCURRENT_ROOMS: "1",
        LIVEKIT_APPROVED_MAX_CONCURRENT_PARTICIPANTS: "10",
        LIVEKIT_APPROVED_MAX_CONCURRENT_EGRESS_JOBS: "1",
        LIVEKIT_APPROVED_MONTHLY_SPEND_AUD: "100",
      }),
    ).not.toThrow();
    expect(() =>
      parseServerEnvironment({
        ...baseEnvironment,
        LIVEKIT_ENABLED: "true",
        LIVEKIT_PROJECT_ENVIRONMENT: "development",
        LIVEKIT_URL: "ws://127.0.0.1:7880",
        LIVEKIT_API_KEY: "development-key",
        LIVEKIT_API_SECRET: "development-secret-with-32-characters",
        LIVEKIT_APPROVED_MAX_PARTICIPANTS: "10",
        LIVEKIT_APPROVED_MAX_CONCURRENT_ROOMS: "1",
      }),
    ).not.toThrow();
    expect(() =>
      parseServerEnvironment({
        ...baseEnvironment,
        LIVEKIT_ENABLED: "true",
        LIVEKIT_PROJECT_ENVIRONMENT: "development",
        LIVEKIT_URL: "ws://127.0.0.1:7880",
        LIVEKIT_API_KEY: "development-key",
        LIVEKIT_API_SECRET: "development-secret-with-32-characters",
        LIVEKIT_APPROVED_MAX_PARTICIPANTS: "11",
        LIVEKIT_APPROVED_MAX_CONCURRENT_ROOMS: "1",
        LIVEKIT_APPROVED_MAX_CONCURRENT_PARTICIPANTS: "10",
        LIVEKIT_APPROVED_MAX_CONCURRENT_EGRESS_JOBS: "1",
        LIVEKIT_APPROVED_MONTHLY_SPEND_AUD: "100",
      }),
    ).toThrow("cannot exceed the approved project participant limit");
  });

  it("requires canonical WSS and non-placeholder LiveKit values outside local environments", () => {
    const deployedLiveKit = {
      ...baseEnvironment,
      APP_ENV: "staging",
      LIVEKIT_ENABLED: "true",
      LIVEKIT_PROJECT_ENVIRONMENT: "staging",
      LIVEKIT_URL: "ws://staging-project.livekit.cloud",
      LIVEKIT_API_KEY: "staging-key",
      LIVEKIT_API_SECRET: "staging-secret-with-at-least-32-characters",
      LIVEKIT_APPROVED_MAX_PARTICIPANTS: "100",
      LIVEKIT_APPROVED_MAX_CONCURRENT_ROOMS: "5",
      LIVEKIT_APPROVED_MAX_CONCURRENT_PARTICIPANTS: "500",
      LIVEKIT_APPROVED_MAX_CONCURRENT_EGRESS_JOBS: "5",
      LIVEKIT_APPROVED_MONTHLY_SPEND_AUD: "1000",
    };
    expect(() => parseServerEnvironment(deployedLiveKit)).toThrow(
      "must use WSS",
    );
    expect(() =>
      parseServerEnvironment({
        ...deployedLiveKit,
        LIVEKIT_URL: "wss://staging-project.livekit.cloud/path",
      }),
    ).toThrow("canonical WebSocket origin");
    expect(() =>
      parseServerEnvironment({
        ...deployedLiveKit,
        LIVEKIT_URL: "wss://staging-project.example",
        LIVEKIT_API_KEY: "REPLACE_WITH_KEY",
      }),
    ).toThrow("configured outside local environments");
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
