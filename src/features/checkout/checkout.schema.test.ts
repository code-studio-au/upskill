import { describe, expect, it } from "vitest";
import { checkoutSessionSearchSchema } from "./checkout.schema";

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
