import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { issueGrantCodes } from "#/server/access/access-grant-code-issuance.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { issueCourseEntitlement } from "#/server/learning/course-entitlement.server";

export interface CheckoutSessionSnapshot {
  id: string;
  application: string | null;
  orderId: string | null;
  orderKind: string | null;
  userId: string | null;
  courseVersionId: string | null;
  clientReferenceId: string | null;
  amountTotal: number | null;
  currency: string | null;
  mode: string | null;
  paymentStatus: string | null;
  paymentIntentId: string | null;
  customerId: string | null;
  invoiceId: string | null;
}

export type FulfillmentResult =
  "fulfilled" | "already-fulfilled" | "review-required" | "ignored";

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

function organizationSlug(name: string, id: string): string {
  const base = name
    .toLocaleLowerCase("en-AU")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 70);
  return `${base || "organisation"}-${id.slice(-8)}`;
}

async function findOrCreateOrganization(
  transaction: Transaction<Database>,
  name: string,
  createdAt: Date,
): Promise<string> {
  const organizationName = name.trim();
  const organizationLock = organizationName.toLocaleLowerCase("en-AU");
  await sql`select pg_advisory_xact_lock(
    hashtextextended(${`access-organisation:${organizationLock}`}, 0)
  )`.execute(transaction);
  const existing = await transaction
    .selectFrom("organization")
    .select("id")
    .where(sql<boolean>`lower(name) = ${organizationLock}`)
    .orderBy("createdAt")
    .executeTakeFirst();
  if (existing) return existing.id;
  const organizationId = `organization_${randomUUID()}`;
  await transaction
    .insertInto("organization")
    .values({
      id: organizationId,
      name: organizationName,
      slug: organizationSlug(organizationName, organizationId),
      createdAt,
    })
    .execute();
  return organizationId;
}

async function fulfillBulkOrder(
  transaction: Transaction<Database>,
  input: {
    order: {
      id: string;
      kind: "bulk_purchase" | "capacity_extension";
      purchaserUserId: string;
    };
    item: {
      courseVersionId: string;
      quantity: number;
      enrollmentDurationDays: number;
    };
    now: Date;
  },
): Promise<string> {
  const purchase = await transaction
    .selectFrom("bulk_order")
    .selectAll()
    .where("orderId", "=", input.order.id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (input.order.kind === "capacity_extension") {
    if (!purchase.accessGrantId)
      throw new Error("Capacity extension is missing its access grant");
    const grant = await transaction
      .selectFrom("access_grant")
      .select([
        "id",
        "courseVersionId",
        "quantity",
        "kind",
        "fulfillmentMode",
        "codePrefix",
      ])
      .where("id", "=", purchase.accessGrantId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (
      grant.kind !== "bulk_purchase" ||
      grant.courseVersionId !== input.item.courseVersionId ||
      grant.fulfillmentMode !== purchase.fulfillmentMode ||
      !grant.codePrefix
    )
      throw new Error("Capacity extension no longer matches its access grant");
    if (grant.fulfillmentMode === "single_use_codes")
      await issueGrantCodes(transaction, {
        accessGrantId: grant.id,
        prefix: grant.codePrefix,
        count: input.item.quantity,
        firstOrdinal: grant.quantity + 1,
        createdAt: input.now,
      });
    await transaction
      .updateTable("access_grant")
      .set({ quantity: grant.quantity + input.item.quantity })
      .where("id", "=", grant.id)
      .executeTakeFirstOrThrow();
    return grant.id;
  }

  if (purchase.accessGrantId)
    throw new Error("Initial bulk order was already linked to a grant");
  const organizationId = await findOrCreateOrganization(
    transaction,
    purchase.organizationName,
    input.now,
  );
  const accessGrantId = `access_grant_${randomUUID()}`;
  await transaction
    .insertInto("access_grant")
    .values({
      id: accessGrantId,
      organizationId,
      orderId: input.order.id,
      courseVersionId: input.item.courseVersionId,
      label: purchase.grantLabel,
      createdByUserId: input.order.purchaserUserId,
      enrollmentDurationDays: input.item.enrollmentDurationDays,
      quantity: input.item.quantity,
      redeemed: 0,
      expiresAt: null,
      revokedAt: null,
      revokedByUserId: null,
      createdAt: input.now,
      kind: "bulk_purchase",
      customerExtendable: purchase.customerExtendable,
      fulfillmentMode: purchase.fulfillmentMode,
      codePrefix: purchase.codePrefix,
    })
    .execute();
  await issueGrantCodes(transaction, {
    accessGrantId,
    prefix: purchase.codePrefix,
    count: purchase.fulfillmentMode === "shared_code" ? 1 : input.item.quantity,
    firstOrdinal: purchase.fulfillmentMode === "shared_code" ? null : 1,
    createdAt: input.now,
  });
  const purchaser = await transaction
    .selectFrom("user")
    .select(["email", "emailVerified", "accountState"])
    .where("id", "=", input.order.purchaserUserId)
    .executeTakeFirstOrThrow();
  const assignmentId = `access_owner_${randomUUID()}`;
  await transaction
    .insertInto("access_grant_owner_assignment")
    .values({
      id: assignmentId,
      accessGrantId,
      userId: input.order.purchaserUserId,
      invitedEmail: purchaser.email.toLocaleLowerCase("en-AU"),
      invitedByUserId: input.order.purchaserUserId,
      invitedAt: input.now,
      activatedAt:
        purchaser.emailVerified && purchaser.accountState === "active"
          ? input.now
          : null,
      revokedAt: null,
      revokedByUserId: null,
    })
    .execute();
  await transaction
    .updateTable("bulk_order")
    .set({ accessGrantId })
    .where("orderId", "=", input.order.id)
    .executeTakeFirstOrThrow();
  await recordDurableAuditEvent(transaction, {
    actorUserId: input.order.purchaserUserId,
    action: "access_grant.owner_assigned",
    subjectType: "access_grant_owner_assignment",
    subjectId: assignmentId,
    aggregateId: accessGrantId,
    metadata: { accessGrantId, ownerUserId: input.order.purchaserUserId },
    createdAt: input.now,
  });
  return accessGrantId;
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
      if (
        order.status === "paid" ||
        order.status === "partially_refunded" ||
        order.status === "refunded"
      )
        return "already-fulfilled";
      if (order.status !== "pending") return "ignored";

      const items = await transaction
        .selectFrom("order_item")
        .selectAll()
        .where("orderId", "=", order.id)
        .execute();
      if (items.length !== 1)
        throw new Error("Single-course Checkout has invalid order items");
      const item = items[0];
      if (!item) throw new Error("Single-course Checkout has no order item");
      if (item.courseVersionId !== session.courseVersionId)
        throw new Error("Upskill Checkout course does not match the order");
      if (session.orderKind && session.orderKind !== order.kind)
        throw new Error("Upskill Checkout kind does not match the order");

      const now = new Date();
      if (order.kind !== "individual_purchase") {
        if (item.quantity < 1)
          throw new Error("Bulk Checkout has invalid order quantity");
        const accessGrantId = await fulfillBulkOrder(transaction, {
          order: {
            id: order.id,
            kind: order.kind,
            purchaserUserId,
          },
          item,
          now,
        });
        await transaction
          .updateTable("order")
          .set({
            status: "paid",
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: session.paymentIntentId,
            stripeInvoiceId: session.invoiceId,
            updatedAt: now,
          })
          .where("id", "=", order.id)
          .executeTakeFirstOrThrow();
        if (session.customerId)
          await transaction
            .updateTable("user")
            .set({ stripeCustomerId: session.customerId, updatedAt: now })
            .where("id", "=", purchaserUserId)
            .where("stripeCustomerId", "is", null)
            .execute();
        await recordDurableAuditEvent(transaction, {
          actorUserId: purchaserUserId,
          action: "order.checkout_paid",
          subjectType: "order",
          subjectId: order.id,
          metadata: {
            stripeCheckoutSessionId: session.id,
            orderKind: order.kind,
            accessGrantId,
            quantity: item.quantity,
          },
          createdAt: now,
        });
        await transaction
          .insertInto("outbox_event")
          .values({
            id: randomUUID(),
            topic: "order.bulk_fulfilled",
            aggregateId: accessGrantId,
            payload: {
              orderId: order.id,
              accessGrantId,
              orderKind: order.kind,
              quantity: item.quantity,
            },
            availableAt: now,
            processedAt: null,
            createdAt: now,
          })
          .execute();
        return "fulfilled";
      }
      if (item.quantity !== 1)
        throw new Error("Individual Checkout has invalid order quantity");
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
          stripeInvoiceId: session.invoiceId,
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
      await transaction
        .insertInto("access_grant")
        .values({
          id: grantId,
          organizationId: null,
          orderId: order.id,
          courseVersionId: item.courseVersionId,
          enrollmentDurationDays: item.enrollmentDurationDays,
          quantity: 1,
          redeemed: 1,
          expiresAt: null,
          kind: "individual_purchase",
          customerExtendable: false,
          fulfillmentMode: null,
        })
        .execute();
      const { enrollmentId } = await issueCourseEntitlement(transaction, {
        userId: purchaserUserId,
        userEmail: (
          await transaction
            .selectFrom("user")
            .select("email")
            .where("id", "=", purchaserUserId)
            .executeTakeFirstOrThrow()
        ).email,
        courseVersionId: item.courseVersionId,
        enrollmentDurationDays: item.enrollmentDurationDays,
        enrollmentAccessGrantId: grantId,
        origin: { type: "order", orderId: order.id },
        createdAt: now,
        eventSource: "stripe-checkout",
      });
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
