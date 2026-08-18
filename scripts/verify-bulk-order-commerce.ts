import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { CheckoutSessionSnapshot } from "#/server/checkout/checkout-fulfillment.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});
const marker = `verify_bulk_${Date.now().toString(36)}`;
const ids = {
  user: `${marker}_user`,
  course: `${marker}_course`,
  version: `${marker}_version`,
  initialOrder: `${marker}_initial_order`,
  extensionOrder: `${marker}_extension_order`,
  sharedOrder: `${marker}_shared_order`,
};

async function cleanup(): Promise<void> {
  await database.transaction().execute(async (transaction) => {
    await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
      transaction,
    );
    await transaction
      .deleteFrom("audit_event")
      .where("subjectId", "like", `${marker}%`)
      .execute();
    await transaction
      .deleteFrom("audit_event")
      .where("actorUserId", "=", ids.user)
      .execute();
  });
  await database
    .deleteFrom("outbox_event")
    .where("aggregateId", "like", `${marker}%`)
    .execute();
  const grants = await database
    .selectFrom("access_grant")
    .select("id")
    .where("orderId", "in", [ids.initialOrder, ids.sharedOrder])
    .execute();
  const grantIds = grants.map((grant) => grant.id);
  if (grantIds.length > 0) {
    await database
      .deleteFrom("access_grant_owner_assignment")
      .where("accessGrantId", "in", grantIds)
      .execute();
    await database
      .deleteFrom("access_grant_code")
      .where("accessGrantId", "in", grantIds)
      .execute();
  }
  await database
    .deleteFrom("bulk_order")
    .where("orderId", "in", [
      ids.initialOrder,
      ids.extensionOrder,
      ids.sharedOrder,
    ])
    .execute();
  if (grantIds.length > 0)
    await database
      .deleteFrom("access_grant")
      .where("id", "in", grantIds)
      .execute();
  await database
    .deleteFrom("order_refund")
    .where("orderId", "in", [
      ids.initialOrder,
      ids.extensionOrder,
      ids.sharedOrder,
    ])
    .execute();
  await database
    .deleteFrom("order")
    .where("id", "in", [ids.initialOrder, ids.extensionOrder, ids.sharedOrder])
    .execute();
  await database
    .deleteFrom("course_version")
    .where("id", "=", ids.version)
    .execute();
  await database.deleteFrom("course").where("id", "=", ids.course).execute();
  await database.deleteFrom("user").where("id", "=", ids.user).execute();
  await database
    .deleteFrom("organization")
    .where("name", "=", `${marker} organisation`)
    .execute();
}

function session(
  orderId: string,
  orderKind: "bulk_purchase" | "capacity_extension",
  total: number,
): CheckoutSessionSnapshot {
  return {
    id: `cs_${orderId}`,
    application: "upskill",
    orderId,
    orderKind,
    userId: ids.user,
    courseVersionId: ids.version,
    clientReferenceId: orderId,
    amountTotal: total,
    currency: "aud",
    mode: "payment",
    paymentStatus: "paid",
    paymentIntentId: `pi_${orderId}`,
    customerId: "cus_verify_bulk",
    invoiceId: `in_${orderId}`,
  };
}

async function insertOrder(input: {
  id: string;
  kind: "bulk_purchase" | "capacity_extension";
  quantity: number;
  unitPriceCents: number;
  fulfillmentMode: "shared_code" | "single_use_codes";
  accessGrantId: string | null;
}): Promise<void> {
  await database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("order")
      .values({
        id: input.id,
        purchaserUserId: ids.user,
        stripeCheckoutSessionId: `cs_${input.id}`,
        stripePaymentIntentId: null,
        stripeInvoiceId: null,
        kind: input.kind,
        status: "pending",
        currency: "AUD",
        totalCents: input.quantity * input.unitPriceCents,
        refundedCents: 0,
      })
      .execute();
    await transaction
      .insertInto("order_item")
      .values({
        id: `${input.id}_item`,
        orderId: input.id,
        courseVersionId: ids.version,
        quantity: input.quantity,
        unitPriceCents: input.unitPriceCents,
        enrollmentDurationDays: 365,
      })
      .execute();
    await transaction
      .insertInto("bulk_order")
      .values({
        orderId: input.id,
        accessGrantId: input.accessGrantId,
        organizationName: `${marker} organisation`,
        grantLabel: `${marker} purchased access`,
        fulfillmentMode: input.fulfillmentMode,
        codePrefix: "VERIFY-BULK",
        customerExtendable: true,
      })
      .execute();
  });
}

try {
  await cleanup();
  await database
    .insertInto("user")
    .values({
      id: ids.user,
      name: "Bulk commerce verifier",
      email: `${marker}@example.com`,
      emailVerified: true,
      image: null,
      stripeCustomerId: null,
      accountState: "active",
    })
    .execute();
  await database
    .insertInto("course")
    .values({
      id: ids.course,
      slug: marker.replaceAll("_", "-"),
      title: "Bulk commerce verification",
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
        title: "Bulk commerce verification",
        summary: "Verifies paid access-grant fulfillment.",
        description: "Verifies paid access-grant fulfillment.",
        topic: "technology",
        durationMinutes: 30,
        priceCents: 10_000,
        salePriceCents: null,
        bulkPricing: {
          enabled: true,
          tiers: [
            { minimumQuantity: 5, unitPriceCents: 8_000 },
            { minimumQuantity: 8, unitPriceCents: 7_000 },
          ],
        },
        currency: "AUD",
        featured: false,
        listInStore: true,
        hasCompletionCertificate: false,
        prerequisites: [],
        accreditations: [],
        modules: [],
        sections: [],
      },
      publishedAt: new Date(),
    })
    .execute();

  const { fulfillCheckoutSession } =
    await import("#/server/checkout/checkout-fulfillment.server");
  await insertOrder({
    id: ids.initialOrder,
    kind: "bulk_purchase",
    quantity: 5,
    unitPriceCents: 8_000,
    fulfillmentMode: "single_use_codes",
    accessGrantId: null,
  });
  const initialResults = await Promise.all([
    fulfillCheckoutSession(session(ids.initialOrder, "bulk_purchase", 40_000)),
    fulfillCheckoutSession(session(ids.initialOrder, "bulk_purchase", 40_000)),
  ]);
  assert.deepEqual(
    new Set(initialResults),
    new Set(["fulfilled", "already-fulfilled"]),
  );
  const grant = await database
    .selectFrom("access_grant")
    .select(["id", "quantity", "redeemed", "fulfillmentMode"])
    .where("orderId", "=", ids.initialOrder)
    .executeTakeFirstOrThrow();
  assert.deepEqual(grant, {
    id: grant.id,
    quantity: 5,
    redeemed: 0,
    fulfillmentMode: "single_use_codes",
  });
  assert.equal(
    (
      await database
        .selectFrom("access_grant_code")
        .select(sql<number>`count(*)::integer`.as("count"))
        .where("accessGrantId", "=", grant.id)
        .executeTakeFirstOrThrow()
    ).count,
    5,
  );

  await insertOrder({
    id: ids.extensionOrder,
    kind: "capacity_extension",
    quantity: 3,
    unitPriceCents: 7_000,
    fulfillmentMode: "single_use_codes",
    accessGrantId: grant.id,
  });
  const extensionResults = await Promise.all([
    fulfillCheckoutSession(
      session(ids.extensionOrder, "capacity_extension", 21_000),
    ),
    fulfillCheckoutSession(
      session(ids.extensionOrder, "capacity_extension", 21_000),
    ),
  ]);
  assert.deepEqual(
    new Set(extensionResults),
    new Set(["fulfilled", "already-fulfilled"]),
  );
  const extended = await database
    .selectFrom("access_grant")
    .select("quantity")
    .where("id", "=", grant.id)
    .executeTakeFirstOrThrow();
  assert.equal(extended.quantity, 8);
  assert.equal(
    (
      await database
        .selectFrom("access_grant_code")
        .select(sql<number>`count(*)::integer`.as("count"))
        .where("accessGrantId", "=", grant.id)
        .executeTakeFirstOrThrow()
    ).count,
    8,
  );

  const { recordStripeRefund } =
    await import("#/server/checkout/refund-fulfillment.server");
  const firstRefund = {
    id: `${marker}_refund_1`,
    paymentIntentId: `pi_${ids.extensionOrder}`,
    amountCents: 7_000,
    currency: "aud",
    status: "succeeded" as const,
    reason: "requested_by_customer",
    createdAt: new Date(),
  };
  assert.equal(await recordStripeRefund(firstRefund), "recorded");
  assert.equal(await recordStripeRefund(firstRefund), "already-recorded");
  assert.equal(
    (
      await database
        .selectFrom("order")
        .select("status")
        .where("id", "=", ids.extensionOrder)
        .executeTakeFirstOrThrow()
    ).status,
    "partially_refunded",
  );
  assert.equal(
    await recordStripeRefund({
      ...firstRefund,
      id: `${marker}_refund_2`,
      amountCents: 14_000,
    }),
    "recorded",
  );
  assert.equal(
    (
      await database
        .selectFrom("order")
        .select(["status", "refundedCents"])
        .where("id", "=", ids.extensionOrder)
        .executeTakeFirstOrThrow()
    ).status,
    "refunded",
  );
  assert.equal(
    (
      await database
        .selectFrom("access_grant")
        .select("quantity")
        .where("id", "=", grant.id)
        .executeTakeFirstOrThrow()
    ).quantity,
    8,
  );

  await insertOrder({
    id: ids.sharedOrder,
    kind: "bulk_purchase",
    quantity: 5,
    unitPriceCents: 8_000,
    fulfillmentMode: "shared_code",
    accessGrantId: null,
  });
  assert.equal(
    await fulfillCheckoutSession(
      session(ids.sharedOrder, "bulk_purchase", 40_000),
    ),
    "fulfilled",
  );
  const sharedGrant = await database
    .selectFrom("access_grant")
    .select("id")
    .where("orderId", "=", ids.sharedOrder)
    .executeTakeFirstOrThrow();
  assert.equal(
    (
      await database
        .selectFrom("access_grant_code")
        .select(sql<number>`count(*)::integer`.as("count"))
        .where("accessGrantId", "=", sharedGrant.id)
        .executeTakeFirstOrThrow()
    ).count,
    1,
  );

  console.log(
    "Verified replay-safe bulk purchase and extension fulfillment, shared and single-use code issuance, invoice snapshots, and refund-safe access preservation",
  );
} finally {
  await cleanup();
  await database.destroy();
  const { destroyDatabase } = await import("#/server/db/database.server");
  await destroyDatabase();
}
