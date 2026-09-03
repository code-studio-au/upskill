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
    expect(environment.LIVEKIT_ENABLED).toBe(false);
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
      }),
    ).not.toThrow();
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
