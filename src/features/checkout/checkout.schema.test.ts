import { describe, expect, it } from "vitest";
import {
  bulkOrderCheckoutInputSchema,
  capacityExtensionCheckoutInputSchema,
  checkoutSessionSearchSchema,
  preparePurchaseAccountInputSchema,
  shouldRedirectToEventRegistrationQuestionnaire,
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

describe("purchase account preparation", () => {
  it("accepts a bounded course purchaser identity", () => {
    expect(
      preparePurchaseAccountInputSchema.parse({
        offeringType: "course",
        slug: "clinical-leadership",
        name: "  Learner Example  ",
        email: "learner@example.com",
      }),
    ).toEqual({
      offeringType: "course",
      slug: "clinical-leadership",
      name: "Learner Example",
      email: "learner@example.com",
    });
  });

  it("rejects an invalid offering type and email", () => {
    expect(
      preparePurchaseAccountInputSchema.safeParse({
        offeringType: "anything",
        slug: "clinical-leadership",
        name: "Learner Example",
        email: "not-an-email",
      }).success,
    ).toBe(false);
  });
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

describe("Event Checkout success routing", () => {
  const eventCheckout = {
    status: "paid" as const,
    offeringType: "event" as const,
    offeringTitle: "Clinical webinar",
    offeringSlug: "clinical-webinar",
    eventOccurrenceId: "event_occurrence_1",
    registrationRequired: true,
    reviewRequired: false,
  };

  it("redirects an individual registration to its questionnaire", () => {
    expect(
      shouldRedirectToEventRegistrationQuestionnaire({
        ...eventCheckout,
        kind: "event_registration",
      }),
    ).toBe(true);
  });

  it.each(["bulk_purchase", "capacity_extension"] as const)(
    "keeps a %s purchaser on the bulk-success flow",
    (kind) => {
      expect(
        shouldRedirectToEventRegistrationQuestionnaire({
          ...eventCheckout,
          kind,
        }),
      ).toBe(false);
    },
  );
});
