import { describe, expect, it, vi } from "vitest";
import {
  createStripeDevelopmentSetup,
  stripeWebhookEvents,
} from "./stripe-development.mjs";

describe("Stripe development listener", () => {
  it("injects the CLI signing secret and constructs the bounded listener", () => {
    const run = vi.fn(() => ({
      status: 0,
      stdout: "whsec_localtest123\n",
    }));
    const setup = createStripeDevelopmentSetup({
      environment: { APP_ENV: "development" },
      run,
    });

    expect(setup.environment.STRIPE_WEBHOOK_SECRET).toBe("whsec_localtest123");
    expect(setup.warning).toBeNull();
    expect(setup.listener?.arguments).toContain(stripeWebhookEvents.join(","));
    expect(setup.listener?.arguments).toContain(
      "http://localhost:3000/api/stripe/webhook",
    );
    expect(run).toHaveBeenCalledOnce();
  });

  it("continues without a listener when Stripe CLI authentication is unavailable", () => {
    const setup = createStripeDevelopmentSetup({
      environment: { APP_ENV: "development" },
      run: () => ({ status: 1, stdout: "", stderr: "not authenticated" }),
    });

    expect(setup.listener).toBeNull();
    expect(setup.environment.STRIPE_WEBHOOK_SECRET).toBe(
      "whsec_local_offline_development",
    );
    expect(setup.warning).toMatch(/run `stripe login`/u);
  });

  it("continues without a listener when Stripe CLI is not installed", () => {
    const setup = createStripeDevelopmentSetup({
      environment: { APP_ENV: "development" },
      run: () => ({
        error: Object.assign(new Error("spawnSync stripe ENOENT"), {
          code: "ENOENT",
        }),
        status: null,
        stdout: "",
        stderr: "",
      }),
    });

    expect(setup.listener).toBeNull();
    expect(setup.warning).toMatch(/Development will continue/u);
  });

  it("continues without a listener when Stripe cannot reach the internet", () => {
    const setup = createStripeDevelopmentSetup({
      environment: { APP_ENV: "development" },
      run: () => ({
        status: 1,
        stdout: "",
        stderr: "dial tcp: lookup api.stripe.com: no such host",
      }),
    });

    expect(setup.listener).toBeNull();
    expect(setup.environment.STRIPE_WEBHOOK_SECRET).toBe(
      "whsec_local_offline_development",
    );
    expect(setup.warning).toMatch(/Development will continue/u);
  });

  it("rejects malformed signing-secret output", () => {
    expect(() =>
      createStripeDevelopmentSetup({
        environment: {},
        run: () => ({ status: 0, stdout: "unexpected output" }),
      }),
    ).toThrow(/invalid webhook signing secret/u);
  });
});
