import "@tanstack/react-start/server-only";

import { createHash, randomUUID } from "node:crypto";
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { PreparePurchaseAccountInput } from "#/features/checkout/checkout.schema";
import { courseContentSchema } from "#/features/catalog/catalog.schema";
import {
  consumeFixedWindowRateLimit,
  forwardedClientAddress,
  type FixedWindowRateLimitEntry,
} from "#/features/event-guest/event-guest-rate-limit";
import { getDatabase } from "#/server/db/database.server";
import { provisionUser } from "#/server/identity/provisional-user.server";

const requestLimits = new Map<string, FixedWindowRateLimitEntry>();
const WINDOW_MS = 15 * 60_000;

function consumeRequestLimit(email: string): boolean {
  const connection = forwardedClientAddress(getRequestHeaders());
  const fingerprint = createHash("sha256")
    .update(`${connection}:${email.trim().toLocaleLowerCase("en-AU")}`)
    .digest("base64url");
  return consumeFixedWindowRateLimit(requestLimits, fingerprint, Date.now(), {
    maximumEntries: 10_000,
    maximumRequests: 5,
    windowMs: WINDOW_MS,
  });
}

async function offeringAvailable(
  input: Pick<PreparePurchaseAccountInput, "offeringType" | "slug">,
): Promise<boolean> {
  const database = getDatabase();
  if (input.offeringType === "course") {
    const row = await database
      .selectFrom("course")
      .innerJoin("course_version", "course_version.courseId", "course.id")
      .select("course_version.content")
      .where("course.slug", "=", input.slug)
      .where("course.status", "=", "published")
      .where("course_version.publishedAt", "is not", null)
      .orderBy("course_version.version", "desc")
      .limit(1)
      .executeTakeFirst();
    if (!row) return false;
    const content = courseContentSchema.parse(row.content);
    return (
      content.listInStore && (content.salePriceCents ?? content.priceCents) > 0
    );
  }
  const row = await database
    .selectFrom("event_occurrence")
    .select("id")
    .where("slug", "=", input.slug)
    .where("status", "=", "published")
    .where("registrationMode", "=", "paid_entry")
    .where("listInStore", "=", true)
    .where("startsAt", ">", new Date())
    .where((expression) =>
      expression.or([
        expression("salePriceCents", ">", 0),
        expression.and([
          expression("salePriceCents", "is", null),
          expression("priceCents", ">", 0),
        ]),
      ]),
    )
    .executeTakeFirst();
  return Boolean(row);
}

export async function preparePurchaseAccount(
  input: PreparePurchaseAccountInput,
): Promise<"ready" | "unavailable" | "rate-limited"> {
  if (!consumeRequestLimit(input.email)) return "rate-limited";
  if (!(await offeringAvailable(input))) return "unavailable";
  const continuePath = `/${input.offeringType === "course" ? "courses" : "events"}/${input.slug}`;
  await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      await provisionUser(transaction, {
        name: input.name,
        email: input.email,
        source: "self_purchase",
        actorUserId: null,
        sourceEventId: `self-purchase:${randomUUID()}`,
        continuePath,
        refreshExistingSetup: {
          reason: "self_purchase",
          minimumIntervalMs: 10 * 60_000,
        },
      });
    });
  return "ready";
}
