import { afterEach, describe, expect, it, vi } from "vitest";

async function parseStripeSecretKey(value: string): Promise<string> {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "test-only-secret-that-is-at-least-32-characters",
  );
  vi.stubEnv("STRIPE_SECRET_KEY", value);
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_placeholder");

  const { getServerEnv } = await import("./env.server");
  return getServerEnv().STRIPE_SECRET_KEY;
}

describe("server environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(["sk_test_placeholder", "rk_test_placeholder"])(
    "accepts the Stripe server key prefix in %s",
    async (value) => {
      await expect(parseStripeSecretKey(value)).resolves.toBe(value);
    },
  );

  it.each(["pk_test_placeholder", "stripe_placeholder"])(
    "rejects a non-secret Stripe key prefix in %s",
    async (value) => {
      await expect(parseStripeSecretKey(value)).rejects.toThrow(
        "Stripe secret key must start with sk_ or rk_",
      );
    },
  );

  it("fails closed when deployed origins are insecure or shared", async () => {
    vi.resetModules();
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "http://app.codestudio.au");
    vi.stubEnv("LEARNING_ORIGIN", "http://app.codestudio.au");
    vi.stubEnv("DATABASE_URL", "postgresql://web:test@localhost/upskill");
    vi.stubEnv(
      "WORKER_DATABASE_URL",
      "postgresql://worker:test@localhost/upskill",
    );
    vi.stubEnv(
      "MIGRATION_DATABASE_URL",
      "postgresql://owner:test@localhost/upskill",
    );
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "test-only-secret-that-is-at-least-32-characters",
    );
    vi.stubEnv("STRIPE_SECRET_KEY", "rk_live_configured");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_configured");
    const { getServerEnv } = await import("./env.server");
    expect(() => getServerEnv()).toThrow(
      "APP_ORIGIN must use HTTPS outside local environments",
    );
  });
});
