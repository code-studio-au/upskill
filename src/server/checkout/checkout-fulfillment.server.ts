import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";

export interface CheckoutSessionSnapshot {
  id: string;
  application: string | null;
  orderId: string | null;
  userId: string | null;
  courseVersionId: string | null;
  clientReferenceId: string | null;
  amountTotal: number | null;
  currency: string | null;
  mode: string | null;
  paymentStatus: string | null;
  paymentIntentId: string | null;
  customerId: string | null;
}

export type FulfillmentResult =
  "fulfilled" | "already-fulfilled" | "review-required" | "ignored";

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1_000);
}

function assertUpskillSession(session: CheckoutSessionSnapshot): string | null {
  if (session.application !== "upskill") return null;
  if (
    !session.orderId ||
    session.clientReferenceId !== session.orderId ||
    !session.userId ||
    !session.courseVersionId
  ) {
    throw new Error("Upskill Checkout metadata is incomplete");
  }
  return session.orderId;
}

export async function fulfillCheckoutSession(
  session: CheckoutSessionSnapshot,
): Promise<FulfillmentResult> {
  const orderId = assertUpskillSession(session);
  if (!orderId || session.mode !== "payment") return "ignored";
  if (session.paymentStatus !== "paid") return "ignored";

  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const order = await transaction
        .selectFrom("order")
        .selectAll()
        .where("id", "=", orderId)
        .forUpdate()
        .executeTakeFirst();
      if (!order) throw new Error("Upskill Checkout order does not exist");
      const purchaserUserId = order.purchaserUserId;
      if (!purchaserUserId || purchaserUserId !== session.userId)
        throw new Error("Upskill Checkout purchaser does not match");
      if (
        order.stripeCheckoutSessionId !== null &&
        order.stripeCheckoutSessionId !== session.id
      ) {
        throw new Error("Upskill Checkout Session does not match the order");
      }
      if (
        session.amountTotal !== order.totalCents ||
        session.currency?.toLocaleUpperCase("en-AU") !== order.currency
      ) {
        throw new Error("Upskill Checkout amount does not match the order");
      }
      if (order.status === "paid") return "already-fulfilled";
      if (order.status !== "pending") return "ignored";

      const items = await transaction
        .selectFrom("order_item")
        .selectAll()
        .where("orderId", "=", order.id)
        .execute();
      if (items.length !== 1 || items[0]?.quantity !== 1)
        throw new Error("Single-course Checkout has invalid order items");
      const item = items[0];
      if (item.courseVersionId !== session.courseVersionId)
        throw new Error("Upskill Checkout course does not match the order");

      const now = new Date();
      const existingEnrollment = await transaction
        .selectFrom("enrollment")
        .select("id")
        .where("userId", "=", purchaserUserId)
        .where("courseVersionId", "=", item.courseVersionId)
        .executeTakeFirst();
      await transaction
        .updateTable("order")
        .set({
          status: "paid",
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: session.paymentIntentId,
          updatedAt: now,
        })
        .where("id", "=", order.id)
        .executeTakeFirstOrThrow();
      if (session.customerId) {
        await transaction
          .updateTable("user")
          .set({ stripeCustomerId: session.customerId, updatedAt: now })
          .where("id", "=", purchaserUserId)
          .where("stripeCustomerId", "is", null)
          .execute();
      }

      if (existingEnrollment) {
        await recordDurableAuditEvent(transaction, {
          actorUserId: purchaserUserId,
          action: "order.paid_existing_enrollment",
          subjectType: "order",
          subjectId: order.id,
          reasonCode: "existing-enrollment",
          metadata: { courseVersionId: item.courseVersionId },
          createdAt: now,
        });
        await transaction
          .insertInto("outbox_event")
          .values({
            id: randomUUID(),
            topic: "order.review_required",
            aggregateId: order.id,
            payload: {
              orderId: order.id,
              enrollmentId: existingEnrollment.id,
              reason: "existing-enrollment",
            },
            availableAt: now,
            processedAt: null,
            createdAt: now,
          })
          .execute();
        return "review-required";
      }

      const grantId = randomUUID();
      const enrollmentId = randomUUID();
      await transaction
        .insertInto("access_grant")
        .values({
          id: grantId,
          organizationId: null,
          orderId: order.id,
          courseVersionId: item.courseVersionId,
          accessCode: null,
          enrollmentDurationDays: item.enrollmentDurationDays,
          quantity: 1,
          redeemed: 1,
          expiresAt: null,
        })
        .execute();
      await transaction
        .insertInto("enrollment")
        .values({
          id: enrollmentId,
          userId: purchaserUserId,
          courseVersionId: item.courseVersionId,
          accessGrantId: grantId,
          status: "active",
          enrolledAt: now,
          completedAt: null,
          expiresAt: addUtcDays(now, item.enrollmentDurationDays),
          removedAt: null,
        })
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: purchaserUserId,
        action: "order.checkout_paid",
        subjectType: "order",
        subjectId: order.id,
        metadata: { stripeCheckoutSessionId: session.id },
        createdAt: now,
      });
      await recordDurableAuditEvent(transaction, {
        actorUserId: purchaserUserId,
        action: "enrollment.purchased",
        subjectType: "enrollment",
        subjectId: enrollmentId,
        metadata: {
          orderId: order.id,
          courseVersionId: item.courseVersionId,
        },
        createdAt: now,
      });
      await transaction
        .insertInto("outbox_event")
        .values({
          id: randomUUID(),
          topic: "enrollment.created",
          aggregateId: enrollmentId,
          payload: {
            enrollmentId,
            userId: purchaserUserId,
            courseVersionId: item.courseVersionId,
            source: "stripe-checkout",
          },
          availableAt: now,
          processedAt: null,
          createdAt: now,
        })
        .execute();
      return "fulfilled";
    });
}

export async function markCheckoutSessionFailed(
  session: CheckoutSessionSnapshot,
): Promise<void> {
  const orderId = assertUpskillSession(session);
  if (!orderId) return;

  await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const order = await transaction
        .selectFrom("order")
        .select(["id", "status", "stripeCheckoutSessionId", "purchaserUserId"])
        .where("id", "=", orderId)
        .forUpdate()
        .executeTakeFirst();
      if (!order || order.status !== "pending") return;
      if (!order.purchaserUserId || order.purchaserUserId !== session.userId)
        throw new Error("Failed Checkout purchaser does not match");
      if (
        order.stripeCheckoutSessionId !== null &&
        order.stripeCheckoutSessionId !== session.id
      ) {
        throw new Error("Failed Checkout Session does not match the order");
      }
      const item = await transaction
        .selectFrom("order_item")
        .select("courseVersionId")
        .where("orderId", "=", order.id)
        .executeTakeFirstOrThrow();
      if (item.courseVersionId !== session.courseVersionId)
        throw new Error("Failed Checkout course does not match the order");
      const now = new Date();
      await transaction
        .updateTable("order")
        .set({
          status: "failed",
          stripeCheckoutSessionId: session.id,
          updatedAt: now,
        })
        .where("id", "=", order.id)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: order.purchaserUserId,
        action: "order.checkout_failed",
        subjectType: "order",
        subjectId: order.id,
        metadata: { stripeCheckoutSessionId: session.id },
        createdAt: now,
      });
    });
}
