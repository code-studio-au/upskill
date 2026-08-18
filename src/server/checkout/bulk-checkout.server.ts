import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type {
  BulkCheckoutResult,
  BulkOrderCheckoutInput,
  CapacityExtensionCheckoutInput,
} from "#/features/checkout/checkout.schema";
import {
  courseContentSchema,
  resolveBulkUnitPrice,
} from "#/features/catalog/catalog.schema";
import { formatAccessCode } from "#/server/access/access-code.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { stripeClient } from "#/server/stripe/stripe-client.server";

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
  courseVersionId: string;
  courseTitle: string;
  courseSummary: string;
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
    courseVersionId: input.courseVersionId,
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
              name: `${input.courseTitle} — bulk access`,
              description: input.courseSummary,
              metadata: { courseVersionId: input.courseVersionId },
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
      courseVersionId: courseRow.courseVersionId,
      courseTitle: content.title,
      courseSummary: content.summary,
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
      .innerJoin(
        "course_version",
        "course_version.id",
        "access_grant.courseVersionId",
      )
      .innerJoin("course", "course.id", "course_version.courseId")
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
        "access_grant.enrollmentDurationDays",
        "organization.name as organizationName",
        "course.slug",
        "course_version.content",
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
    const content = courseContentSchema.parse(grant.content);
    const resultingQuantity = grant.quantity + input.quantity;
    const unitPriceCents = resolveBulkUnitPrice(
      content.bulkPricing,
      resultingQuantity,
    );
    const totalCents = unitPriceCents
      ? validatedTotal(unitPriceCents, input.quantity)
      : null;
    if (!unitPriceCents || !totalCents)
      return { status: "unavailable", reason: "quantity" };
    const createdOrderId = randomUUID();
    orderId = createdOrderId;
    await database.transaction().execute(async (transaction) => {
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
          courseVersionId: grant.courseVersionId,
          quantity: input.quantity,
          unitPriceCents,
          enrollmentDurationDays: grant.enrollmentDurationDays,
        })
        .execute();
      await transaction
        .insertInto("bulk_order")
        .values({
          orderId: createdOrderId,
          accessGrantId: grant.id,
          organizationName: grant.organizationName,
          grantLabel:
            grant.label ?? grantLabel(grant.organizationName, content.title),
          fulfillmentMode,
          codePrefix,
          customerExtendable: true,
        })
        .execute();
    });
    const checkout = await createStripeCheckout({
      orderId: createdOrderId,
      orderKind: "capacity_extension",
      purchaser: user,
      stripeCustomerId: grant.stripeCustomerId,
      courseVersionId: grant.courseVersionId,
      courseTitle: content.title,
      courseSummary: `${String(input.quantity)} additional access seats`,
      quantity: input.quantity,
      unitPriceCents,
      currency: content.currency,
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
