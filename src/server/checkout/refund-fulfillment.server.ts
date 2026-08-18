import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";

export interface RefundSnapshot {
  id: string;
  paymentIntentId: string | null;
  amountCents: number;
  currency: string;
  status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled";
  reason: string | null;
  createdAt: Date;
}

export async function recordStripeRefund(
  refund: RefundSnapshot,
): Promise<"recorded" | "already-recorded" | "ignored"> {
  if (!refund.paymentIntentId) return "ignored";
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const order = await transaction
        .selectFrom("order")
        .select(["id", "purchaserUserId", "status", "currency", "totalCents"])
        .where("stripePaymentIntentId", "=", refund.paymentIntentId)
        .forUpdate()
        .executeTakeFirst();
      if (!order) return "ignored" as const;
      if (refund.currency.toLocaleUpperCase("en-AU") !== order.currency)
        throw new Error("Stripe refund currency does not match the order");
      const existing = await transaction
        .selectFrom("order_refund")
        .select(["amountCents", "currency", "status", "reason"])
        .where("stripeRefundId", "=", refund.id)
        .executeTakeFirst();
      if (
        existing?.amountCents === refund.amountCents &&
        existing.currency === refund.currency &&
        existing.status === refund.status &&
        existing.reason === refund.reason
      )
        return "already-recorded" as const;
      const now = new Date();
      await transaction
        .insertInto("order_refund")
        .values({
          stripeRefundId: refund.id,
          orderId: order.id,
          amountCents: refund.amountCents,
          currency: refund.currency,
          status: refund.status,
          reason: refund.reason,
          createdAt: refund.createdAt,
          updatedAt: now,
        })
        .onConflict((conflict) =>
          conflict.column("stripeRefundId").doUpdateSet({
            amountCents: refund.amountCents,
            currency: refund.currency,
            status: refund.status,
            reason: refund.reason,
            updatedAt: now,
          }),
        )
        .execute();
      const totals = await transaction
        .selectFrom("order_refund")
        .select(
          sql<number>`coalesce(sum("amountCents") filter (where status = 'succeeded'), 0)::integer`.as(
            "refundedCents",
          ),
        )
        .where("orderId", "=", order.id)
        .executeTakeFirstOrThrow();
      if (totals.refundedCents > order.totalCents)
        throw new Error("Stripe refunds exceed the order total");
      const orderStatus =
        totals.refundedCents === 0
          ? "paid"
          : totals.refundedCents === order.totalCents
            ? "refunded"
            : "partially_refunded";
      await transaction
        .updateTable("order")
        .set({
          refundedCents: totals.refundedCents,
          status: orderStatus,
          updatedAt: now,
        })
        .where("id", "=", order.id)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: order.purchaserUserId,
        action: "order.refund_recorded",
        subjectType: "order_refund",
        subjectId: refund.id,
        aggregateId: order.id,
        metadata: {
          orderId: order.id,
          amountCents: refund.amountCents,
          refundStatus: refund.status,
          resultingOrderStatus: orderStatus,
          accessPreserved: true,
        },
        createdAt: now,
      });
      await transaction
        .insertInto("outbox_event")
        .values({
          id: randomUUID(),
          topic: "order.refund_recorded",
          aggregateId: order.id,
          payload: {
            orderId: order.id,
            stripeRefundId: refund.id,
            status: refund.status,
            amountCents: refund.amountCents,
            accessPreserved: true,
          },
          availableAt: now,
          processedAt: null,
          createdAt: now,
        })
        .execute();
      return "recorded" as const;
    });
}
