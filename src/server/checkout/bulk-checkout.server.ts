import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type {
  BulkCheckoutResult,
  BulkOrderCheckoutInput,
  CapacityExtensionCheckoutInput,
} from "#/features/checkout/checkout.schema";
import {
  bulkPricingSchema,
  courseContentSchema,
  resolveBulkUnitPrice,
} from "#/features/catalog/catalog.schema";
import { formatAccessCode } from "#/server/access/access-code.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { stripeClient } from "#/server/stripe/stripe-client.server";
import { findReservedEventPlaces } from "./event-commerce-capacity.server";

const ENROLLMENT_DURATION_DAYS = 365;
const MAX_ORDER_TOTAL_CENTS = 2_000_000_000;

function applicationUrl(path: string): string {
  return new URL(path, getServerEnv().APP_ORIGIN).toString();
}

function purchasedCodePrefix(
  organizationName: string,
  courseTitle: string,
): string {
  const candidate = `${organizationName} ${courseTitle}`
    .toLocaleUpperCase("en-AU")
    .replaceAll(/[^A-Z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "")
    .slice(0, 48);
  return (
    formatAccessCode(candidate.replaceAll(/-$/gu, "").padEnd(8, "X")) ??
    "BULK-ACCESS"
  );
}

function grantLabel(organizationName: string, courseTitle: string): string {
  return `${organizationName} — ${courseTitle}`.slice(0, 120).trim();
}

function validatedTotal(
  unitPriceCents: number,
  quantity: number,
): number | null {
  const total = unitPriceCents * quantity;
  return Number.isSafeInteger(total) &&
    total > 0 &&
    total <= MAX_ORDER_TOTAL_CENTS
    ? total
    : null;
}

function validatedCheckoutUrl(url: string | null): string {
  if (!url) throw new Error("Stripe Checkout did not return a URL");
  const checkoutUrl = new URL(url);
  if (
    checkoutUrl.protocol !== "https:" ||
    checkoutUrl.hostname !== "checkout.stripe.com"
  )
    throw new Error("Stripe Checkout returned an unexpected URL");
  return checkoutUrl.toString();
}

async function createStripeCheckout(input: {
  orderId: string;
  orderKind: "bulk_purchase" | "capacity_extension";
  purchaser: AuthenticatedUser;
  stripeCustomerId: string | null;
  target: { type: "course"; id: string } | { type: "event"; id: string };
  offeringTitle: string;
  offeringSummary: string;
  quantity: number;
  unitPriceCents: number;
  currency: string;
  cancelPath: string;
}): Promise<{ id: string; url: string }> {
  const metadata = {
    application: "upskill",
    orderId: input.orderId,
    orderKind: input.orderKind,
    userId: input.purchaser.id,
    ...(input.target.type === "course"
      ? { courseVersionId: input.target.id }
      : { eventOccurrenceId: input.target.id }),
  };
  const session = await stripeClient.checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: input.orderId,
      ...(input.stripeCustomerId
        ? { customer: input.stripeCustomerId }
        : {
            customer_creation: "always" as const,
            customer_email: input.purchaser.email,
          }),
      line_items: [
        {
          quantity: input.quantity,
          price_data: {
            currency: input.currency.toLocaleLowerCase("en-AU"),
            unit_amount: input.unitPriceCents,
            tax_behavior: "inclusive",
            product_data: {
              name: `${input.offeringTitle} — bulk access`,
              description: input.offeringSummary,
              metadata:
                input.target.type === "course"
                  ? { courseVersionId: input.target.id }
                  : { eventOccurrenceId: input.target.id },
            },
          },
        },
      ],
      invoice_creation: {
        enabled: true,
        invoice_data: { metadata },
      },
      metadata,
      payment_intent_data: { metadata },
      success_url: `${getServerEnv().APP_ORIGIN.replace(/\/$/u, "")}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: applicationUrl(input.cancelPath),
    },
    { idempotencyKey: `upskill-${input.orderKind}-${input.orderId}` },
  );
  return { id: session.id, url: validatedCheckoutUrl(session.url) };
}

async function markCreationFailed(
  orderId: string | null,
  user: AuthenticatedUser,
  error: unknown,
): Promise<BulkCheckoutResult> {
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
    event: "bulk_checkout.creation_failed",
    error,
    fields: { actorUserId: user.id, ...(orderId ? { orderId } : {}) },
  });
  return { status: "unavailable", reason: "payment" };
}

export async function createInitialBulkCheckout(
  input: BulkOrderCheckoutInput,
  user: AuthenticatedUser,
): Promise<BulkCheckoutResult> {
  let orderId: string | null = null;
  try {
    const database = getDatabase();
    const courseRow = await database
      .selectFrom("course")
      .innerJoin("course_version", "course_version.courseId", "course.id")
      .select([
        "course.slug",
        "course_version.id as courseVersionId",
        "course_version.content",
      ])
      .where("course.slug", "=", input.slug)
      .where("course.status", "=", "published")
      .where("course_version.publishedAt", "is not", null)
      .orderBy("course_version.version", "desc")
      .limit(1)
      .executeTakeFirst();
    if (!courseRow) return { status: "unavailable", reason: "course" };
    const content = courseContentSchema.parse(courseRow.content);
    if (!content.listInStore)
      return { status: "unavailable", reason: "course" };
    const unitPriceCents = resolveBulkUnitPrice(
      content.bulkPricing,
      input.quantity,
    );
    const totalCents = unitPriceCents
      ? validatedTotal(unitPriceCents, input.quantity)
      : null;
    if (!unitPriceCents || !totalCents)
      return { status: "unavailable", reason: "quantity" };
    const purchaser = await database
      .selectFrom("user")
      .select("stripeCustomerId")
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow();
    const createdOrderId = randomUUID();
    orderId = createdOrderId;
    const organizationName = input.organizationName.trim();
    await database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("order")
        .values({
          id: createdOrderId,
          purchaserUserId: user.id,
          stripeCheckoutSessionId: null,
          stripePaymentIntentId: null,
          stripeInvoiceId: null,
          kind: "bulk_purchase",
          status: "pending",
          currency: content.currency,
          totalCents,
          refundedCents: 0,
        })
        .execute();
      await transaction
        .insertInto("order_item")
        .values({
          id: randomUUID(),
          orderId: createdOrderId,
          courseVersionId: courseRow.courseVersionId,
          eventOccurrenceId: null,
          quantity: input.quantity,
          unitPriceCents,
          enrollmentDurationDays: ENROLLMENT_DURATION_DAYS,
        })
        .execute();
      await transaction
        .insertInto("bulk_order")
        .values({
          orderId: createdOrderId,
          accessGrantId: null,
          organizationName,
          grantLabel: grantLabel(organizationName, content.title),
          fulfillmentMode: input.fulfillmentMode,
          codePrefix: purchasedCodePrefix(organizationName, content.title),
          customerExtendable: true,
        })
        .execute();
    });
    const checkout = await createStripeCheckout({
      orderId: createdOrderId,
      orderKind: "bulk_purchase",
      purchaser: user,
      stripeCustomerId: purchaser.stripeCustomerId,
      target: { type: "course", id: courseRow.courseVersionId },
      offeringTitle: content.title,
      offeringSummary: content.summary,
      quantity: input.quantity,
      unitPriceCents,
      currency: content.currency,
      cancelPath: `/courses/${input.slug}/bulk-order`,
    });
    await database
      .updateTable("order")
      .set({ stripeCheckoutSessionId: checkout.id, updatedAt: new Date() })
      .where("id", "=", createdOrderId)
      .where("status", "=", "pending")
      .executeTakeFirstOrThrow();
    return { status: "redirect", url: checkout.url };
  } catch (error) {
    return await markCreationFailed(orderId, user, error);
  }
}

export async function createInitialEventBulkCheckout(
  input: BulkOrderCheckoutInput,
  user: AuthenticatedUser,
): Promise<BulkCheckoutResult> {
  let orderId: string | null = null;
  try {
    const database = getDatabase();
    const event = await database
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
        "occurrence.startsAt",
        "occurrence.currency",
        "occurrence.bulkPricing",
        "occurrence.listInStore",
        "version.summary",
      ])
      .where("occurrence.slug", "=", input.slug)
      .where("occurrence.status", "=", "published")
      .where("occurrence.listInStore", "=", true)
      .executeTakeFirst();
    if (!event || event.startsAt <= new Date())
      return { status: "unavailable", reason: "event" };
    const pricing = bulkPricingSchema.parse(event.bulkPricing);
    const unitPriceCents = resolveBulkUnitPrice(pricing, input.quantity);
    const totalCents = unitPriceCents
      ? validatedTotal(unitPriceCents, input.quantity)
      : null;
    if (!unitPriceCents || !totalCents)
      return { status: "unavailable", reason: "quantity" };
    const purchaser = await database
      .selectFrom("user")
      .select("stripeCustomerId")
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow();
    const createdOrderId = randomUUID();
    orderId = createdOrderId;
    const organizationName = input.organizationName.trim();
    const orderReserved = await database
      .transaction()
      .execute(async (transaction) => {
        const locked = await transaction
          .selectFrom("event_occurrence")
          .select(["capacity", "confirmedCount"])
          .where("id", "=", event.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const reservedPlaces = await findReservedEventPlaces(
          transaction,
          event.id,
          new Date(),
        );
        if (
          locked.confirmedCount + reservedPlaces + input.quantity >
          locked.capacity
        )
          return false;
        await transaction
          .insertInto("order")
          .values({
            id: createdOrderId,
            purchaserUserId: user.id,
            stripeCheckoutSessionId: null,
            stripePaymentIntentId: null,
            stripeInvoiceId: null,
            kind: "bulk_purchase",
            status: "pending",
            currency: event.currency,
            totalCents,
            refundedCents: 0,
          })
          .execute();
        await transaction
          .insertInto("order_item")
          .values({
            id: randomUUID(),
            orderId: createdOrderId,
            courseVersionId: null,
            eventOccurrenceId: event.id,
            quantity: input.quantity,
            unitPriceCents,
            enrollmentDurationDays: null,
          })
          .execute();
        await transaction
          .insertInto("bulk_order")
          .values({
            orderId: createdOrderId,
            accessGrantId: null,
            organizationName,
            grantLabel: grantLabel(organizationName, event.title),
            fulfillmentMode: input.fulfillmentMode,
            codePrefix: purchasedCodePrefix(organizationName, event.title),
            customerExtendable: true,
          })
          .execute();
        return true;
      });
    if (!orderReserved) {
      orderId = null;
      return { status: "unavailable", reason: "quantity" };
    }
    const checkout = await createStripeCheckout({
      orderId: createdOrderId,
      orderKind: "bulk_purchase",
      purchaser: user,
      stripeCustomerId: purchaser.stripeCustomerId,
      target: { type: "event", id: event.id },
      offeringTitle: event.title,
      offeringSummary: event.summary,
      quantity: input.quantity,
      unitPriceCents,
      currency: event.currency,
      cancelPath: `/events/${input.slug}/bulk-order`,
    });
    await database
      .updateTable("order")
      .set({
        stripeCheckoutSessionId: checkout.id,
        updatedAt: new Date(),
      })
      .where("id", "=", createdOrderId)
      .where("status", "=", "pending")
      .executeTakeFirstOrThrow();
    return { status: "redirect", url: checkout.url };
  } catch (error) {
    return await markCreationFailed(orderId, user, error);
  }
}

export async function createCapacityExtensionCheckout(
  input: CapacityExtensionCheckoutInput,
  user: AuthenticatedUser,
): Promise<BulkCheckoutResult> {
  let orderId: string | null = null;
  try {
    const database = getDatabase();
    const grant = await database
      .selectFrom("access_grant_owner_assignment as assignment")
      .innerJoin("access_grant", "access_grant.id", "assignment.accessGrantId")
      .innerJoin(
        "organization",
        "organization.id",
        "access_grant.organizationId",
      )
      .leftJoin(
        "course_version",
        "course_version.id",
        "access_grant.courseVersionId",
      )
      .leftJoin("course", "course.id", "course_version.courseId")
      .leftJoin(
        "event_occurrence",
        "event_occurrence.id",
        "access_grant.eventOccurrenceId",
      )
      .leftJoin(
        "event_template_version",
        "event_template_version.id",
        "event_occurrence.eventTemplateVersionId",
      )
      .innerJoin("user", "user.id", "assignment.userId")
      .select([
        "access_grant.id",
        "access_grant.label",
        "access_grant.quantity",
        "access_grant.kind",
        "access_grant.customerExtendable",
        "access_grant.fulfillmentMode",
        "access_grant.codePrefix",
        "access_grant.revokedAt",
        "access_grant.expiresAt",
        "access_grant.courseVersionId",
        "access_grant.eventOccurrenceId",
        "access_grant.enrollmentDurationDays",
        "organization.name as organizationName",
        "course.slug",
        "course_version.content",
        "event_occurrence.slug as eventSlug",
        "event_occurrence.title as eventTitle",
        "event_occurrence.currency as eventCurrency",
        "event_occurrence.bulkPricing as eventBulkPricing",
        "event_occurrence.startsAt as eventStartsAt",
        "event_occurrence.status as eventStatus",
        "event_template_version.summary as eventSummary",
        "user.stripeCustomerId",
      ])
      .where("assignment.accessGrantId", "=", input.accessGrantId)
      .where("assignment.userId", "=", user.id)
      .where("assignment.activatedAt", "is not", null)
      .where("assignment.revokedAt", "is", null)
      .executeTakeFirst();
    const now = new Date();
    if (
      !grant ||
      grant.kind !== "bulk_purchase" ||
      !grant.customerExtendable ||
      grant.revokedAt ||
      (grant.expiresAt && grant.expiresAt <= now) ||
      !grant.fulfillmentMode ||
      !grant.codePrefix
    )
      return { status: "unavailable", reason: "grant" };
    const fulfillmentMode = grant.fulfillmentMode;
    const codePrefix = grant.codePrefix;
    const target = grant.courseVersionId
      ? (() => {
          if (!grant.content || !grant.slug || !grant.enrollmentDurationDays)
            return null;
          const content = courseContentSchema.parse(grant.content);
          return {
            type: "course" as const,
            id: grant.courseVersionId,
            slug: grant.slug,
            title: content.title,
            summary: content.summary,
            currency: content.currency,
            pricing: content.bulkPricing,
            enrollmentDurationDays: grant.enrollmentDurationDays,
          };
        })()
      : grant.eventOccurrenceId &&
          grant.eventSlug &&
          grant.eventTitle &&
          grant.eventSummary &&
          grant.eventCurrency &&
          grant.eventBulkPricing &&
          grant.eventStatus === "published" &&
          grant.eventStartsAt &&
          grant.eventStartsAt > now
        ? {
            type: "event" as const,
            id: grant.eventOccurrenceId,
            slug: grant.eventSlug,
            title: grant.eventTitle,
            summary: grant.eventSummary,
            currency: grant.eventCurrency,
            pricing: bulkPricingSchema.parse(grant.eventBulkPricing),
            enrollmentDurationDays: null,
          }
        : null;
    if (!target) return { status: "unavailable", reason: "grant" };
    const resultingQuantity = grant.quantity + input.quantity;
    const unitPriceCents = resolveBulkUnitPrice(
      target.pricing,
      resultingQuantity,
    );
    const totalCents = unitPriceCents
      ? validatedTotal(unitPriceCents, input.quantity)
      : null;
    if (!unitPriceCents || !totalCents)
      return { status: "unavailable", reason: "quantity" };
    const createdOrderId = randomUUID();
    orderId = createdOrderId;
    const orderReserved = await database
      .transaction()
      .execute(async (transaction) => {
        if (target.type === "event") {
          const locked = await transaction
            .selectFrom("event_occurrence")
            .select(["capacity", "confirmedCount"])
            .where("id", "=", target.id)
            .forUpdate()
            .executeTakeFirstOrThrow();
          const reservedPlaces = await findReservedEventPlaces(
            transaction,
            target.id,
            new Date(),
          );
          if (
            locked.confirmedCount + reservedPlaces + input.quantity >
            locked.capacity
          )
            return false;
        }
        await transaction
          .insertInto("order")
          .values({
            id: createdOrderId,
            purchaserUserId: user.id,
            stripeCheckoutSessionId: null,
            stripePaymentIntentId: null,
            stripeInvoiceId: null,
            kind: "capacity_extension",
            status: "pending",
            currency: target.currency,
            totalCents,
            refundedCents: 0,
          })
          .execute();
        await transaction
          .insertInto("order_item")
          .values({
            id: randomUUID(),
            orderId: createdOrderId,
            courseVersionId: target.type === "course" ? target.id : null,
            eventOccurrenceId: target.type === "event" ? target.id : null,
            quantity: input.quantity,
            unitPriceCents,
            enrollmentDurationDays: target.enrollmentDurationDays,
          })
          .execute();
        await transaction
          .insertInto("bulk_order")
          .values({
            orderId: createdOrderId,
            accessGrantId: grant.id,
            organizationName: grant.organizationName,
            grantLabel:
              grant.label ?? grantLabel(grant.organizationName, target.title),
            fulfillmentMode,
            codePrefix,
            customerExtendable: true,
          })
          .execute();
        return true;
      });
    if (!orderReserved) {
      orderId = null;
      return { status: "unavailable", reason: "quantity" };
    }
    const checkout = await createStripeCheckout({
      orderId: createdOrderId,
      orderKind: "capacity_extension",
      purchaser: user,
      stripeCustomerId: grant.stripeCustomerId,
      target: { type: target.type, id: target.id },
      offeringTitle: target.title,
      offeringSummary: `${String(input.quantity)} additional access seats`,
      quantity: input.quantity,
      unitPriceCents,
      currency: target.currency,
      cancelPath: "/access-management",
    });
    await database
      .updateTable("order")
      .set({ stripeCheckoutSessionId: checkout.id, updatedAt: new Date() })
      .where("id", "=", createdOrderId)
      .where("status", "=", "pending")
      .executeTakeFirstOrThrow();
    return { status: "redirect", url: checkout.url };
  } catch (error) {
    return await markCreationFailed(orderId, user, error);
  }
}
