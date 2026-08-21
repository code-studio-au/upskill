import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { EventCheckoutResult } from "#/features/checkout/checkout.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { stripeClient } from "#/server/stripe/stripe-client.server";
import { findReservedEventPlaces } from "./event-commerce-capacity.server";

const RESERVATION_MINUTES = 31;

export async function createEventCheckout(
  slug: string,
  user: AuthenticatedUser,
): Promise<EventCheckoutResult> {
  let orderId: string | null = null;
  try {
    const database = getDatabase();
    const purchaser = await database
      .selectFrom("user")
      .select("stripeCustomerId")
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow();
    const checkout = await database
      .transaction()
      .execute(async (transaction) => {
        const occurrence = await transaction
          .selectFrom("event_occurrence as occurrence")
          .innerJoin(
            "event_template_version as version",
            "version.id",
            "occurrence.eventTemplateVersionId",
          )
          .select([
            "occurrence.id",
            "occurrence.title",
            "occurrence.slug",
            "occurrence.status",
            "occurrence.registrationMode",
            "occurrence.startsAt",
            "occurrence.capacity",
            "occurrence.confirmedCount",
            "occurrence.priceCents",
            "occurrence.salePriceCents",
            "occurrence.currency",
            "occurrence.listInStore",
            "version.summary",
          ])
          .where("occurrence.slug", "=", slug)
          .forUpdate("occurrence")
          .executeTakeFirst();
        const now = new Date();
        const unitPriceCents =
          occurrence?.salePriceCents ?? occurrence?.priceCents;
        if (
          !occurrence ||
          occurrence.status !== "published" ||
          occurrence.registrationMode !== "paid_entry" ||
          !occurrence.listInStore ||
          occurrence.startsAt <= now ||
          !unitPriceCents
        )
          return { status: "unavailable" } as const;

        const existing = await transaction
          .selectFrom("event_registration")
          .select("id")
          .where("eventOccurrenceId", "=", occurrence.id)
          .where("userId", "=", user.id)
          .executeTakeFirst();
        if (existing) return { status: "already-registered" } as const;

        const reservedPlaces = await findReservedEventPlaces(
          transaction,
          occurrence.id,
          now,
        );
        if (occurrence.confirmedCount + reservedPlaces >= occurrence.capacity)
          return { status: "unavailable" } as const;

        const createdOrderId = randomUUID();
        await transaction
          .insertInto("order")
          .values({
            id: createdOrderId,
            purchaserUserId: user.id,
            stripeCheckoutSessionId: null,
            stripePaymentIntentId: null,
            stripeInvoiceId: null,
            kind: "event_registration",
            status: "pending",
            currency: occurrence.currency,
            totalCents: unitPriceCents,
            refundedCents: 0,
          })
          .execute();
        await transaction
          .insertInto("order_item")
          .values({
            id: randomUUID(),
            orderId: createdOrderId,
            courseVersionId: null,
            eventOccurrenceId: occurrence.id,
            quantity: 1,
            unitPriceCents,
            enrollmentDurationDays: null,
          })
          .execute();
        return {
          status: "ready",
          occurrence,
          orderId: createdOrderId,
          unitPriceCents,
          expiresAt: Math.floor(
            (now.getTime() + RESERVATION_MINUTES * 60_000) / 1000,
          ),
        } as const;
      });
    if (checkout.status !== "ready") return checkout;
    orderId = checkout.orderId;

    const metadata = {
      application: "upskill",
      orderId: checkout.orderId,
      orderKind: "event_registration",
      userId: user.id,
      eventOccurrenceId: checkout.occurrence.id,
    };
    const session = await stripeClient.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: checkout.orderId,
        ...(purchaser.stripeCustomerId
          ? { customer: purchaser.stripeCustomerId }
          : { customer_creation: "always", customer_email: user.email }),
        expires_at: checkout.expiresAt,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: checkout.occurrence.currency.toLocaleLowerCase("en-AU"),
              unit_amount: checkout.unitPriceCents,
              tax_behavior: "inclusive",
              product_data: {
                name: checkout.occurrence.title,
                description: checkout.occurrence.summary,
                metadata: { eventOccurrenceId: checkout.occurrence.id },
              },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        success_url: `${getServerEnv().APP_ORIGIN.replace(/\/$/u, "")}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: new URL(
          `/events/${checkout.occurrence.slug}`,
          getServerEnv().APP_ORIGIN,
        ).toString(),
      },
      { idempotencyKey: `upskill-event-registration-${checkout.orderId}` },
    );
    if (!session.url) throw new Error("Stripe Checkout did not return a URL");
    const url = new URL(session.url);
    if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com")
      throw new Error("Stripe Checkout returned an unexpected URL");
    await database
      .updateTable("order")
      .set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() })
      .where("id", "=", checkout.orderId)
      .where("status", "=", "pending")
      .executeTakeFirstOrThrow();
    return { status: "redirect", url: url.toString() };
  } catch (error) {
    if (orderId)
      await getDatabase()
        .updateTable("order")
        .set({ status: "failed", updatedAt: new Date() })
        .where("id", "=", orderId)
        .where("status", "=", "pending")
        .execute()
        .catch(() => undefined);
    logServerEvent({
      level: "error",
      event: "event_checkout.creation_failed",
      error,
      fields: { actorUserId: user.id, ...(orderId ? { orderId } : {}) },
    });
    return { status: "unavailable" };
  }
}
