import { spawnSync } from "node:child_process";

const OFFLINE_WEBHOOK_SECRET = "whsec_local_offline_development";

export const stripeWebhookEvents = Object.freeze([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "refund.created",
  "refund.updated",
  "refund.failed",
]);

export function createStripeDevelopmentSetup({
  environment = process.env,
  run = spawnSync,
} = {}) {
  const result = run(
    "stripe",
    ["listen", "--print-secret", "--skip-update", "--color", "off"],
    {
      encoding: "utf8",
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    },
  );
  const failureDetail = [result.error?.message, result.stderr]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-AU");
  const networkUnavailable =
    result.error?.code === "ETIMEDOUT" ||
    /(?:api\.stripe\.com|connection|dial tcp|dns|network|no such host|offline|timed? ?out|timeout)/u.test(
      failureDetail,
    );
  if ((result.error || result.status !== 0) && networkUnavailable)
    return {
      environment: {
        ...environment,
        STRIPE_WEBHOOK_SECRET:
          environment.STRIPE_WEBHOOK_SECRET || OFFLINE_WEBHOOK_SECRET,
      },
      listener: null,
      warning:
        "Stripe webhook forwarding is offline. Development will continue, but webhook-driven checkout updates require an internet connection.",
    };
  if (result.error || result.status !== 0)
    throw new Error(
      "Stripe CLI is unavailable or not authenticated. Install Stripe CLI and run `stripe login` before starting development.",
    );

  const signingSecret = result.stdout.trim();
  if (!/^whsec_[A-Za-z0-9]+$/u.test(signingSecret))
    throw new Error("Stripe CLI returned an invalid webhook signing secret.");

  return {
    environment: { ...environment, STRIPE_WEBHOOK_SECRET: signingSecret },
    listener: {
      script: "stripe:webhooks",
      command: "stripe",
      arguments: [
        "listen",
        "--skip-update",
        "--color",
        "off",
        "--events",
        stripeWebhookEvents.join(","),
        "--forward-to",
        "http://localhost:3000/api/stripe/webhook",
      ],
      // The listener banner repeats the temporary signing secret on stderr.
      // App-side webhook logs remain visible, while Stripe CLI output is
      // suppressed to avoid exposing that secret in terminal transcripts.
      stdio: ["ignore", "ignore", "ignore"],
    },
    warning: null,
  };
}
