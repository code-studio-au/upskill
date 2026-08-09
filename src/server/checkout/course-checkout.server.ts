import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { CourseCheckoutResult } from "#/features/checkout/checkout.schema";
import { courseContentSchema } from "#/features/catalog/catalog.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { stripeClient } from "#/server/stripe/stripe-client.server";

const ENROLLMENT_DURATION_DAYS = 365;

function applicationUrl(path: string): string {
  return new URL(path, getServerEnv().APP_ORIGIN).toString();
}

export async function createCourseCheckout(
  slug: string,
  user: AuthenticatedUser,
): Promise<CourseCheckoutResult> {
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
      .where("course.slug", "=", slug)
      .where("course.status", "=", "published")
      .where("course_version.publishedAt", "is not", null)
      .orderBy("course_version.version", "desc")
      .limit(1)
      .executeTakeFirst();
    if (!courseRow) return { status: "unavailable" };

    const content = courseContentSchema.parse(courseRow.content);
    const unitPriceCents = content.salePriceCents ?? content.priceCents;
    if (!content.listInStore || unitPriceCents <= 0)
      return { status: "unavailable" };

    const existingEnrollment = await database
      .selectFrom("enrollment")
      .select("id")
      .where("userId", "=", user.id)
      .where("courseVersionId", "=", courseRow.courseVersionId)
      .executeTakeFirst();
    if (existingEnrollment) return { status: "already-enrolled" };

    const purchaser = await database
      .selectFrom("user")
      .select("stripeCustomerId")
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow();

    const createdOrderId = randomUUID();
    orderId = createdOrderId;
    const orderItemId = randomUUID();
    await database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("order")
        .values({
          id: createdOrderId,
          purchaserUserId: user.id,
          stripeCheckoutSessionId: null,
          stripePaymentIntentId: null,
          status: "pending",
          currency: content.currency,
          totalCents: unitPriceCents,
        })
        .execute();
      await transaction
        .insertInto("order_item")
        .values({
          id: orderItemId,
          orderId: createdOrderId,
          courseVersionId: courseRow.courseVersionId,
          quantity: 1,
          unitPriceCents,
          enrollmentDurationDays: ENROLLMENT_DURATION_DAYS,
        })
        .execute();
    });

    const metadata = {
      application: "upskill",
      orderId: createdOrderId,
      userId: user.id,
      courseVersionId: courseRow.courseVersionId,
    };
    const session = await stripeClient.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: createdOrderId,
        ...(purchaser.stripeCustomerId
          ? { customer: purchaser.stripeCustomerId }
          : { customer_creation: "always", customer_email: user.email }),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: content.currency.toLocaleLowerCase("en-AU"),
              unit_amount: unitPriceCents,
              tax_behavior: "inclusive",
              product_data: {
                name: content.title,
                description: content.summary,
                metadata: { courseVersionId: courseRow.courseVersionId },
              },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        success_url: `${getServerEnv().APP_ORIGIN.replace(/\/$/, "")}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: applicationUrl(`/courses/${slug}`),
      },
      { idempotencyKey: `upskill-course-checkout-${createdOrderId}` },
    );
    if (!session.url) throw new Error("Stripe Checkout did not return a URL");
    const checkoutUrl = new URL(session.url);
    if (
      checkoutUrl.protocol !== "https:" ||
      checkoutUrl.hostname !== "checkout.stripe.com"
    ) {
      throw new Error("Stripe Checkout returned an unexpected URL");
    }

    await database
      .updateTable("order")
      .set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() })
      .where("id", "=", createdOrderId)
      .where("status", "=", "pending")
      .executeTakeFirstOrThrow();
    return { status: "redirect", url: checkoutUrl.toString() };
  } catch (error) {
    if (orderId) {
      await getDatabase()
        .updateTable("order")
        .set({ status: "failed", updatedAt: new Date() })
        .where("id", "=", orderId)
        .where("status", "=", "pending")
        .execute()
        .catch(() => undefined);
    }
    console.error("Course Checkout creation failed", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return { status: "unavailable" };
  }
}
