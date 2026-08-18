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
});
