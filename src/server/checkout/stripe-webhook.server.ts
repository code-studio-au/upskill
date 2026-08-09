import "@tanstack/react-start/server-only";

import type Stripe from "stripe";
import { getServerEnv } from "#/server/env.server";
import { stripeClient } from "#/server/stripe/stripe-client.server";
import {
  fulfillCheckoutSession,
  markCheckoutSessionFailed,
  type CheckoutSessionSnapshot,
} from "./checkout-fulfillment.server";

function objectId(value: string | { id: string } | null): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

function snapshotSession(
  session: Stripe.Checkout.Session,
): CheckoutSessionSnapshot {
  return {
    id: session.id,
    application: session.metadata?.application ?? null,
    orderId: session.metadata?.orderId ?? null,
    userId: session.metadata?.userId ?? null,
    courseVersionId: session.metadata?.courseVersionId ?? null,
    clientReferenceId: session.client_reference_id,
    amountTotal: session.amount_total,
    currency: session.currency,
    mode: session.mode,
    paymentStatus: session.payment_status,
    paymentIntentId: objectId(session.payment_intent),
    customerId: objectId(session.customer),
  };
}

export function constructStripeEvent(
  payload: Buffer,
  signature: string,
): Stripe.Event {
  return stripeClient.webhooks.constructEvent(
    payload,
    signature,
    getServerEnv().STRIPE_WEBHOOK_SECRET,
  );
}

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    await fulfillCheckoutSession(snapshotSession(event.data.object));
    return;
  }
  if (
    event.type === "checkout.session.async_payment_failed" ||
    event.type === "checkout.session.expired"
  ) {
    await markCheckoutSessionFailed(snapshotSession(event.data.object));
  }
}
