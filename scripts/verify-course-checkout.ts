import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { withAuditMaintenance } from "./audit-maintenance";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { CheckoutSessionSnapshot } from "#/server/checkout/checkout-fulfillment.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  user: "verify_checkout_user",
  course: "verify_checkout_course",
  version: "verify_checkout_version",
  paidOrder: "verify_checkout_paid_order",
  mismatchOrder: "verify_checkout_mismatch_order",
  failedOrder: "verify_checkout_failed_order",
};
const user: AuthenticatedUser = {
  id: ids.user,
  name: "Checkout Verifier",
  email: "checkout-verifier@example.com",
  emailVerified: true,
};

const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

async function cleanup(): Promise<void> {
  await withAuditMaintenance(database, async (database) => {
    const enrollments = await database
      .selectFrom("enrollment")
      .select("id")
      .where("userId", "=", ids.user)
      .execute();
    const enrollmentIds = enrollments.map((row) => row.id);
    if (enrollmentIds.length > 0) {
      await database
        .deleteFrom("outbox_event")
        .where("aggregateId", "in", enrollmentIds)
        .execute();
      await database
        .deleteFrom("audit_event")
        .where("subjectId", "in", enrollmentIds)
        .execute();
    }
    await database
      .deleteFrom("outbox_event")
      .where("aggregateId", "in", [
        ids.paidOrder,
        ids.mismatchOrder,
        ids.failedOrder,
      ])
      .execute();
    await database
      .deleteFrom("audit_event")
      .where("subjectId", "in", [
        ids.paidOrder,
        ids.mismatchOrder,
        ids.failedOrder,
      ])
      .execute();
    await database
      .deleteFrom("enrollment")
      .where("userId", "=", ids.user)
      .execute();
    await database
      .deleteFrom("access_grant")
      .where("orderId", "in", [
        ids.paidOrder,
        ids.mismatchOrder,
        ids.failedOrder,
      ])
      .execute();
    await database
      .deleteFrom("order_item")
      .where("orderId", "in", [
        ids.paidOrder,
        ids.mismatchOrder,
        ids.failedOrder,
      ])
      .execute();
    await database
      .deleteFrom("order")
      .where("id", "in", [ids.paidOrder, ids.mismatchOrder, ids.failedOrder])
      .execute();
    await database
      .deleteFrom("course_version")
      .where("id", "=", ids.version)
      .execute();
    await database.deleteFrom("course").where("id", "=", ids.course).execute();
    await database.deleteFrom("user").where("id", "=", ids.user).execute();
  });
}

function sessionFor(
  orderId: string,
  sessionId: string,
): CheckoutSessionSnapshot {
  return {
    id: sessionId,
    application: "upskill",
    orderId,
    userId: ids.user,
    courseVersionId: ids.version,
    clientReferenceId: orderId,
    amountTotal: 12_900,
    currency: "aud",
    mode: "payment",
    paymentStatus: "paid",
    paymentIntentId: `pi_${orderId}`,
    customerId: "cus_verify_checkout",
  };
}

try {
  await cleanup();
  await database
    .insertInto("user")
    .values({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: null,
      stripeCustomerId: null,
    })
    .execute();
  await database
    .insertInto("course")
    .values({
      id: ids.course,
      slug: "verify-checkout-course",
      title: "Verified Checkout course",
      status: "published",
    })
    .execute();
  await database
    .insertInto("course_version")
    .values({
      id: ids.version,
      courseId: ids.course,
      version: 1,
      content: {
        title: "Verified Checkout course",
        summary: "Database verification fixture",
        description: "Database verification fixture for Stripe Checkout.",
        topic: "technology",
        durationMinutes: 30,
        priceCents: 12_900,
        salePriceCents: null,
        currency: "AUD",
        featured: false,
        listInStore: true,
        hasCompletionCertificate: false,
        prerequisites: [],
        accreditations: [],
        modules: [],
      },
      publishedAt: new Date(),
    })
    .execute();

  const orderIds = [ids.paidOrder, ids.mismatchOrder, ids.failedOrder];
  await database
    .insertInto("order")
    .values(
      orderIds.map((orderId) => ({
        id: orderId,
        purchaserUserId: ids.user,
        stripeCheckoutSessionId: `cs_test_${orderId}`,
        stripePaymentIntentId: null,
        status: "pending" as const,
        currency: "AUD",
        totalCents: 12_900,
      })),
    )
    .execute();
  await database
    .insertInto("order_item")
    .values(
      orderIds.map((orderId) => ({
        id: `item_${orderId}`,
        orderId,
        courseVersionId: ids.version,
        quantity: 1,
        unitPriceCents: 12_900,
        enrollmentDurationDays: 365,
      })),
    )
    .execute();

  const { fulfillCheckoutSession, markCheckoutSessionFailed } =
    await import("#/server/checkout/checkout-fulfillment.server");
  const paidSession = sessionFor(ids.paidOrder, `cs_test_${ids.paidOrder}`);
  const replayResults = await Promise.all([
    fulfillCheckoutSession(paidSession),
    fulfillCheckoutSession(paidSession),
  ]);
  assert.deepEqual(replayResults.sort(), ["already-fulfilled", "fulfilled"]);

  const mismatchSession = sessionFor(
    ids.mismatchOrder,
    `cs_test_${ids.mismatchOrder}`,
  );
  await assert.rejects(
    fulfillCheckoutSession({ ...mismatchSession, amountTotal: 12_899 }),
    /amount does not match/,
  );
  await markCheckoutSessionFailed(
    sessionFor(ids.failedOrder, `cs_test_${ids.failedOrder}`),
  );

  const paidOrder = await database
    .selectFrom("order")
    .select(["status", "stripePaymentIntentId"])
    .where("id", "=", ids.paidOrder)
    .executeTakeFirstOrThrow();
  assert.equal(paidOrder.status, "paid");
  assert.equal(paidOrder.stripePaymentIntentId, `pi_${ids.paidOrder}`);
  const pendingOrder = await database
    .selectFrom("order")
    .select("status")
    .where("id", "=", ids.mismatchOrder)
    .executeTakeFirstOrThrow();
  assert.equal(pendingOrder.status, "pending");
  const failedOrder = await database
    .selectFrom("order")
    .select("status")
    .where("id", "=", ids.failedOrder)
    .executeTakeFirstOrThrow();
  assert.equal(failedOrder.status, "failed");

  const enrollment = await database
    .selectFrom("enrollment")
    .select(["id", "accessGrantId", "expiresAt"])
    .where("userId", "=", ids.user)
    .executeTakeFirstOrThrow();
  assert.ok(enrollment.accessGrantId);
  assert.ok(enrollment.expiresAt);
  const grant = await database
    .selectFrom("access_grant")
    .select([
      "orderId",
      "quantity",
      "redeemed",
      "accessCodeLookupId",
      "encryptedAccessCode",
    ])
    .where("id", "=", enrollment.accessGrantId)
    .executeTakeFirstOrThrow();
  assert.equal(grant.orderId, ids.paidOrder);
  assert.equal(grant.quantity, 1);
  assert.equal(grant.redeemed, 1);
  assert.equal(grant.accessCodeLookupId, null);
  assert.equal(grant.encryptedAccessCode, null);

  const auditCount = await database
    .selectFrom("audit_event")
    .select(sql<number>`count(*)::integer`.as("count"))
    .where((expression) =>
      expression.or([
        expression("subjectId", "=", ids.paidOrder),
        expression("subjectId", "=", enrollment.id),
      ]),
    )
    .executeTakeFirstOrThrow();
  assert.equal(auditCount.count, 2);
  const outboxCount = await database
    .selectFrom("outbox_event")
    .select(sql<number>`count(*)::integer`.as("count"))
    .where("aggregateId", "=", enrollment.id)
    .executeTakeFirstOrThrow();
  assert.equal(outboxCount.count, 2);

  const { findCheckoutStatus } =
    await import("#/server/checkout/checkout-status.server");
  assert.deepEqual(await findCheckoutStatus(`cs_test_${ids.paidOrder}`, user), {
    status: "paid",
    courseTitle: "Verified Checkout course",
    courseSlug: "verify-checkout-course",
  });
  assert.equal(await findCheckoutStatus("cs_test_unknown", user), null);

  console.log(
    "Verified replay-safe Checkout fulfilment, reconciliation failure, failed-session handling and entitlement writes",
  );
} finally {
  await cleanup();
  await database.destroy();
  const { destroyDatabase } = await import("#/server/db/database.server");
  await destroyDatabase();
}
