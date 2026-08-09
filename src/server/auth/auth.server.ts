import "@tanstack/react-start/server-only";

import { stripe as betterAuthStripe } from "@better-auth/stripe";
import { betterAuth } from "better-auth";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { stripeClient } from "#/server/stripe/stripe-client.server";

const env = getServerEnv();

export const auth = betterAuth({
  appName: "Upskill",
  baseURL: env.APP_ORIGIN,
  secret: env.BETTER_AUTH_SECRET,
  database: { db: getDatabase(), type: "postgres", transaction: true },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    requireEmailVerification: true,
  },
  trustedOrigins: [env.APP_ORIGIN],
  rateLimit: {
    enabled: true,
    storage: "memory",
    window: 60,
    max: 100,
  },
  advanced: {
    useSecureCookies: env.APP_ENV === "production" || env.APP_ENV === "staging",
    ipAddress: {
      // nginx must overwrite this header; the application never trusts a client value.
      ipAddressHeaders: ["x-real-ip"],
    },
  },
  plugins: [
    betterAuthStripe({
      stripeClient,
      stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
      createCustomerOnSignUp: false,
      subscription: { enabled: false },
    }),
  ],
});
