import { describe, expect, it } from "vitest";
import { validateDeployedRuntimeEnvironment } from "./validate-runtime-environment.ts";

function stagingEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    APP_ENV: "staging",
    APP_ORIGIN: "https://staging.codestudio.au",
    LEARNING_ORIGIN: "https://learn-staging.codestudio.au",
    SUPPORT_EMAIL: "support@codestudio.au",
    DATABASE_URL: "postgresql://web:secret@database/upskill",
    WORKER_DATABASE_URL: "postgresql://worker:secret@database/upskill",
    MIGRATION_DATABASE_URL: "postgresql://owner:secret@database/upskill",
    BETTER_AUTH_SECRET: "a-secure-auth-secret-that-is-long-enough",
    ACCESS_CODE_ENCRYPTION_KEY: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    STRIPE_SECRET_KEY: "rk_test_configured",
    STRIPE_WEBHOOK_SECRET: "whsec_configured",
    EMAIL_PROVIDER: "mailgun",
    MAILGUN_API_KEY: "configured-domain-key",
    MAILGUN_DOMAIN: "mg.codestudio.au",
    MAILGUN_FROM: "Upskill <no-reply@codestudio.au>",
    MAILGUN_API_BASE_URL: "https://api.mailgun.net",
    SMS_PROVIDER: "textbee",
    TEXTBEE_API_KEY: "configured-textbee-key",
    TEXTBEE_API_BASE_URL: "https://api.textbee.dev",
    TEXTBEE_WEBHOOK_SECRET: "configured-webhook-secret",
    LIVEKIT_ENABLED: "false",
    LIVEKIT_PROJECT_ENVIRONMENT: "staging",
    AWS_REGION: "ap-southeast-2",
    S3_QUARANTINE_BUCKET: "upskill-staging-quarantine",
    S3_LEARNING_CONTENT_BUCKET: "upskill-staging-learning",
    S3_PRIVATE_RESOURCES_BUCKET: "upskill-staging-private",
    SQS_QUEUE_URL:
      "https://sqs.ap-southeast-2.amazonaws.com/123456789012/upskill-work",
    SQS_DEAD_LETTER_QUEUE_URL:
      "https://sqs.ap-southeast-2.amazonaws.com/123456789012/upskill-work-dlq",
    SQS_RECEIVE_WAIT_SECONDS: "20",
    SQS_VISIBILITY_TIMEOUT_SECONDS: "900",
    NODE_ENV: "production",
    UPSKILL_TRUST_PROXY: "true",
    ...overrides,
  };
}

describe("deployed runtime environment", () => {
  it("accepts the complete least-privilege staging contract", () => {
    expect(() => {
      validateDeployedRuntimeEnvironment(stagingEnvironment());
    }).not.toThrow();
  });

  it.each([
    ["S3_ENDPOINT", "https://storage.example.test"],
    ["S3_ACCESS_KEY_ID", "static-access-key"],
    ["S3_SECRET_ACCESS_KEY", "static-secret-key"],
    ["SQS_ENDPOINT", "https://queue.example.test"],
    ["S3_FORCE_PATH_STYLE", "true"],
  ])("rejects deployed local override %s", (key, value) => {
    expect(() => {
      validateDeployedRuntimeEnvironment(stagingEnvironment({ [key]: value }));
    }).toThrow(/outside local environments/u);
  });

  it.each([
    ["APP_ORIGIN", "https://staging.example.invalid"],
    ["MAILGUN_API_KEY", "REPLACE_WITH_DOMAIN_KEY"],
    ["TEXTBEE_WEBHOOK_SECRET", "REPLACE_WITH_WEBHOOK_SECRET"],
  ])("rejects placeholder deployment value %s", (key, value) => {
    expect(() => {
      validateDeployedRuntimeEnvironment(stagingEnvironment({ [key]: value }));
    }).toThrow(/configured outside local environments/u);
  });

  it.each([
    ["WORKER_DATABASE_URL", undefined],
    ["MIGRATION_DATABASE_URL", undefined],
    ["NODE_ENV", "development"],
    ["UPSKILL_TRUST_PROXY", "false"],
  ])("rejects invalid deployment-only value %s", (key, value) => {
    expect(() => {
      validateDeployedRuntimeEnvironment(stagingEnvironment({ [key]: value }));
    }).toThrow(/deployment environment|must be/u);
  });
});
