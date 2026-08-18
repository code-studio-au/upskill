import { describe, expect, it } from "vitest";
import {
  eventGuestReferenceSchema,
  eventGuestSubmissionSchema,
} from "./event-guest.schema";

describe("event guest access schemas", () => {
  const publicReference = "A234567890_bcdefghijklmnopqrstuv";

  it("accepts a bounded opaque reference and privacy-accepted identity", () => {
    expect(
      eventGuestSubmissionSchema.parse({
        publicReference,
        name: "  Guest Learner  ",
        email: "guest@example.com",
        privacyAccepted: true,
      }),
    ).toMatchObject({
      publicReference,
      name: "Guest Learner",
      email: "guest@example.com",
      privacyAccepted: true,
    });
  });

  it("rejects malformed references and a missing privacy acceptance", () => {
    expect(
      eventGuestReferenceSchema.safeParse({ publicReference: "guessable" })
        .success,
    ).toBe(false);
    expect(
      eventGuestSubmissionSchema.safeParse({
        publicReference,
        name: "Guest Learner",
        email: "guest@example.com",
        privacyAccepted: false,
      }).success,
    ).toBe(false);
  });
});
