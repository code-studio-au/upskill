import { describe, expect, it } from "vitest";
import {
  bulkOrderCheckoutInputSchema,
  capacityExtensionCheckoutInputSchema,
  checkoutSessionSearchSchema,
} from "./checkout.schema";

describe("checkout session search", () => {
  it.each(["cs_test_123", "cs_live_ABC_def"])(
    "accepts a Stripe Checkout Session ID %s",
    (sessionId) => {
      expect(
        checkoutSessionSearchSchema.parse({ session_id: sessionId }),
      ).toEqual({ session_id: sessionId });
    },
  );

  it.each(["", "pi_test_123", "cs_test_123?next=https://example.com"])(
    "rejects an invalid session reference %s",
    (sessionId) => {
      expect(() =>
        checkoutSessionSearchSchema.parse({ session_id: sessionId }),
      ).toThrow();
    },
  );
});

describe("bulk Checkout input", () => {
  it("accepts a bounded initial shared-code order", () => {
    expect(
      bulkOrderCheckoutInputSchema.parse({
        slug: "leadership-course",
        organizationName: "Example Health",
        quantity: 20,
        fulfillmentMode: "shared_code",
      }),
    ).toEqual({
      slug: "leadership-course",
      organizationName: "Example Health",
      quantity: 20,
      fulfillmentMode: "shared_code",
    });
  });

  it("requires at least two seats for an initial bulk order", () => {
    expect(() =>
      bulkOrderCheckoutInputSchema.parse({
        slug: "leadership-course",
        organizationName: "Example Health",
        quantity: 1,
        fulfillmentMode: "single_use_codes",
      }),
    ).toThrow();
  });

  it("allows a one-seat extension of an eligible existing grant", () => {
    expect(
      capacityExtensionCheckoutInputSchema.parse({
        accessGrantId: "access_grant_1",
        quantity: 1,
      }),
    ).toEqual({ accessGrantId: "access_grant_1", quantity: 1 });
  });
});
